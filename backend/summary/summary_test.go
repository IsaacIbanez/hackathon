package summary

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

const letter = `Le informamos de que su póliza de seguro de hogar vence el 31 de diciembre de 2026. ` +
	`Para mantener la cobertura sin interrupciones, la renovación se realizará de forma automática. ` +
	`La prima anual para el próximo periodo será de 284,60 euros. ` +
	`Agradecemos su confianza en nuestra compañía. ` +
	`Si tiene cualquier duda, puede llamarnos de lunes a viernes.`

// fakeModel answers like OpenRouter and records the prompt it received.
func fakeModel(t *testing.T, answer string, status int) (*llm.Client, *string) {
	t.Helper()
	var prompt string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		prompt = string(body)
		if status != http.StatusOK {
			http.Error(w, "down", status)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "test/cheap",
			"choices": []any{map[string]any{"message": map[string]any{"content": answer}}},
			"usage":   map[string]any{"prompt_tokens": 120, "completion_tokens": 40, "cost": 0.0001},
		})
	}))
	t.Cleanup(srv.Close)
	c := llm.New("test-key")
	c.BaseURL = srv.URL
	c.Models[llm.Cheap] = "test/cheap"
	c.Cache = nil
	return c, &prompt
}

func TestSummarizeWithTheCheapModel(t *testing.T) {
	c, prompt := fakeModel(t, "**Resumen:** Su seguro de hogar vence el 31 de diciembre y se renueva solo por 284,60 euros.", http.StatusOK)
	res := Summarize(context.Background(), c, letter)
	if res.Source != "cloud" || res.Summary != "Su seguro de hogar vence el 31 de diciembre y se renueva solo por 284,60 euros." {
		t.Fatalf("result: %+v", res)
	}
	if res.CostUSD != 0.0001 || res.Model != "test/cheap" || res.Lang != "es-ES" || res.Truncated {
		t.Errorf("metadata: %+v", res)
	}
	if !strings.Contains(*prompt, "284,60 euros") || !strings.Contains(*prompt, "2 or 3 short, plain sentences") {
		t.Errorf("prompt: %s", *prompt)
	}
	if c.Stats().TotalCostUSD == 0 {
		t.Error("the cost must be counted in the meter (it shows in the app's stats)")
	}
}

func TestFallsBackToLocal(t *testing.T) {
	c, _ := fakeModel(t, "", http.StatusServiceUnavailable)
	res := Summarize(context.Background(), c, letter)
	if res.Source != "local" || !strings.HasPrefix(res.Note, "model failed") {
		t.Fatalf("model down: %+v", res)
	}
	res = Summarize(context.Background(), nil, letter)
	if res.Source != "local" || res.CostUSD != 0 || !strings.Contains(res.Note, "no OpenRouter key") {
		t.Fatalf("no key: %+v", res)
	}
}

func TestLocalKeepsDatesAndAmounts(t *testing.T) {
	s := Local(letter)
	for _, want := range []string{"31 de diciembre", "284,60 euros"} {
		if !strings.Contains(s, want) {
			t.Errorf("local summary %q lacks %q", s, want)
		}
	}
	if strings.Contains(s, "Agradecemos") {
		t.Errorf("local summary keeps a filler sentence: %q", s)
	}
	if strings.Index(s, "31 de diciembre") > strings.Index(s, "284,60") {
		t.Errorf("sentences must keep their order: %q", s)
	}
}

func TestShortTextIsReadAsIs(t *testing.T) {
	res := Summarize(context.Background(), nil, "  Total: 76,29 €  ")
	if res.Source != "short" || res.Summary != "Total: 76,29 €" {
		t.Fatalf("%+v", res)
	}
}

func TestPrepareCutsLongTexts(t *testing.T) {
	long := strings.Repeat("Esta es una frase del contrato. ", 600) // ~19 000 chars
	clean, truncated := Prepare(long)
	if !truncated || len([]rune(clean)) > MaxChars || !strings.HasSuffix(clean, ".") {
		t.Fatalf("truncated=%v len=%d end=%q", truncated, len([]rune(clean)), clean[len(clean)-10:])
	}
	if clean, truncated := Prepare("a\n\n  b\tc"); truncated || clean != "a b c" {
		t.Fatalf("short: %q %v", clean, truncated)
	}
}

func TestDetectLang(t *testing.T) {
	cases := map[string]string{
		letter: "es-ES",
		"Benvolgut client, us informem que el rebut del subministrament d'aigua encara no s'ha pogut cobrar i cal pagar-lo amb el codi": "ca-ES",
		"Your home insurance policy expires on 31 December and the premium for the next year is 284 euros":                              "en-GB",
	}
	for text, want := range cases {
		if got := DetectLang(text); got != want {
			t.Errorf("DetectLang(%.30q…) = %s, want %s", text, got, want)
		}
	}
}
