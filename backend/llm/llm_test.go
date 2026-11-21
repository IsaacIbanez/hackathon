package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// openRouterFalso responde como OpenRouter y cuenta las llamadas por modelo.
func openRouterFalso(t *testing.T, llamadas map[string]*atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer clave-test" {
			http.Error(w, `{"error":{"message":"no autorizado"}}`, http.StatusUnauthorized)
			return
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		model, _ := req["model"].(string)
		if c, ok := llamadas[model]; ok {
			c.Add(1)
		}
		if model == "roto" {
			http.Error(w, `{"error":{"message":"modelo caído"}}`, http.StatusBadGateway)
			return
		}
		texto := "respuesta de " + model
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   model,
			"choices": []any{map[string]any{"message": map[string]any{"content": texto}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.0015},
		})
	}))
}

func clientePrueba(url string) *Client {
	c := New("clave-test")
	c.BaseURL = url
	c.Models = map[Tier]string{Barato: "barato-m", Caro: "caro-m"}
	return c
}

func pregunta(texto string) Request {
	return Request{Messages: []Message{{Role: "user", Text: texto}}}
}

func TestCompleteDevuelveTextoCosteYTokens(t *testing.T) {
	srv := openRouterFalso(t, nil)
	defer srv.Close()
	c := clientePrueba(srv.URL)

	r, err := c.Complete(context.Background(), pregunta("hola"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Text != "respuesta de barato-m" || r.Tier != Barato || r.CostUSD != 0.0015 || r.PromptTokens != 100 || r.Cached {
		t.Fatalf("respuesta inesperada: %+v", r)
	}
	if st := c.Meter.Snapshot(); st.Barato.Calls != 1 || st.TotalCostUSD != 0.0015 {
		t.Fatalf("contador: %+v", st)
	}
}

func TestLaCacheEvitaLaSegundaLlamada(t *testing.T) {
	n := &atomic.Int32{}
	srv := openRouterFalso(t, map[string]*atomic.Int32{"barato-m": n})
	defer srv.Close()
	c := clientePrueba(srv.URL)

	for range 3 {
		if _, err := c.Complete(context.Background(), pregunta("misma pregunta")); err != nil {
			t.Fatal(err)
		}
	}
	r, _ := c.Complete(context.Background(), pregunta("misma pregunta"))
	if n.Load() != 1 || !r.Cached || r.CostUSD != 0 {
		t.Fatalf("llamadas reales = %d, cached = %v, coste = %v", n.Load(), r.Cached, r.CostUSD)
	}
	st := c.Meter.Snapshot()
	if st.Barato.Calls != 1 || st.Barato.CacheHits != 3 || st.TotalCostUSD != 0.0015 {
		t.Fatalf("contador: %+v", st)
	}
}

func TestEscalaSoloSiHayDuda(t *testing.T) {
	barato, caro := &atomic.Int32{}, &atomic.Int32{}
	srv := openRouterFalso(t, map[string]*atomic.Int32{"barato-m": barato, "caro-m": caro})
	defer srv.Close()
	c := clientePrueba(srv.URL)
	ctx := context.Background()

	r, escalo, err := c.CompleteEscalando(ctx, pregunta("fácil"), func(Response) bool { return false })
	if err != nil || escalo || r.Tier != Barato {
		t.Fatalf("sin duda no debe escalar: %+v %v %v", r, escalo, err)
	}

	r, escalo, err = c.CompleteEscalando(ctx, pregunta("difícil"), func(r Response) bool { return strings.Contains(r.Text, "barato") })
	if err != nil || !escalo || r.Tier != Caro || r.Text != "respuesta de caro-m" {
		t.Fatalf("con duda debe escalar: %+v %v %v", r, escalo, err)
	}
	if barato.Load() != 2 || caro.Load() != 1 {
		t.Fatalf("llamadas barato=%d caro=%d", barato.Load(), caro.Load())
	}
}

func TestEscalaSiElBaratoFalla(t *testing.T) {
	srv := openRouterFalso(t, nil)
	defer srv.Close()
	c := clientePrueba(srv.URL)
	c.Models[Barato] = "roto"

	r, escalo, err := c.CompleteEscalando(context.Background(), pregunta("hola"), nil)
	if err != nil || !escalo || r.Tier != Caro {
		t.Fatalf("debería escalar tras el error: %+v %v %v", r, escalo, err)
	}
	if st := c.Meter.Snapshot(); st.Barato.Errors != 1 || st.Caro.Calls != 1 {
		t.Fatalf("contador: %+v", st)
	}
}

func TestErrorHTTPIncluyeElMensajeSinLaClave(t *testing.T) {
	srv := openRouterFalso(t, nil)
	defer srv.Close()
	c := clientePrueba(srv.URL)
	c.Models[Barato] = "roto"

	_, err := c.Complete(context.Background(), pregunta("hola"))
	if err == nil || !strings.Contains(err.Error(), "modelo caído") || strings.Contains(err.Error(), "clave-test") {
		t.Fatalf("error inesperado: %v", err)
	}
}

func TestSinClave(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	if _, err := NewFromEnv(); err != ErrSinClave {
		t.Fatalf("esperaba ErrSinClave, llegó %v", err)
	}
}

func TestFormatoMultimodalYJSON(t *testing.T) {
	req := Request{
		System:   "Eres un asistente.",
		JSON:     true,
		Messages: []Message{{Role: "user", Text: "¿Qué pone?", Images: []string{"data:image/jpeg;base64,AAAA"}}},
	}
	datos, _ := json.Marshal(toOpenRouter("m", req))
	s := string(datos)
	for _, trozo := range []string{
		`"role":"system","content":"Eres un asistente."`,
		`{"type":"text","text":"¿Qué pone?"}`,
		`{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,AAAA"}}`,
		`"response_format":{"type":"json_object"}`,
		`"max_tokens":1024`,
	} {
		if !strings.Contains(s, trozo) {
			t.Errorf("falta %s en %s", trozo, s)
		}
	}
}

func TestCacheExpulsaLaMasAntigua(t *testing.T) {
	c := NewCache(2)
	c.Put("a", Response{Text: "a"})
	c.Put("b", Response{Text: "b"})
	c.Put("c", Response{Text: "c"})
	if _, ok := c.Get("a"); ok {
		t.Fatal("a debería haberse expulsado")
	}
	if _, ok := c.Get("c"); !ok {
		t.Fatal("falta c")
	}
}
