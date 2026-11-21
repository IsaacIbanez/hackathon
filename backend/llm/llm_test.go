package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeOpenRouter answers like OpenRouter and counts calls per model.
// Model "broken" always fails with 502.
func fakeOpenRouter(t *testing.T, calls map[string]*atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, `{"error":{"message":"unauthorized"}}`, http.StatusUnauthorized)
			return
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		model, _ := req["model"].(string)
		if c, ok := calls[model]; ok {
			c.Add(1)
		}
		if model == "broken" {
			http.Error(w, `{"error":{"message":"model is down"}}`, http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   model,
			"choices": []any{map[string]any{"message": map[string]any{"content": "answer from " + model}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.0015},
		})
	}))
}

func testClient(url string) *Client {
	c := New("test-key")
	c.BaseURL = url
	c.Models = map[Tier]string{Cheap: "cheap-m", Expensive: "expensive-m"}
	return c
}

func ask(text string) Request {
	return Request{Messages: []Message{{Role: "user", Text: text}}}
}

func TestCompleteReturnsTextCostAndTokens(t *testing.T) {
	srv := fakeOpenRouter(t, nil)
	defer srv.Close()
	c := testClient(srv.URL)

	r, err := c.Complete(context.Background(), ask("hello"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Text != "answer from cheap-m" || r.Tier != Cheap || r.CostUSD != 0.0015 || r.PromptTokens != 100 || r.Cached {
		t.Fatalf("unexpected response: %+v", r)
	}
	if st := c.Meter.Snapshot(); st.Cheap.Calls != 1 || st.TotalCostUSD != 0.0015 {
		t.Fatalf("meter: %+v", st)
	}
}

func TestCacheAvoidsRepeatedCalls(t *testing.T) {
	n := &atomic.Int32{}
	srv := fakeOpenRouter(t, map[string]*atomic.Int32{"cheap-m": n})
	defer srv.Close()
	c := testClient(srv.URL)

	for range 3 {
		if _, err := c.Complete(context.Background(), ask("same question")); err != nil {
			t.Fatal(err)
		}
	}
	r, _ := c.Complete(context.Background(), ask("same question"))
	if n.Load() != 1 || !r.Cached || r.CostUSD != 0 {
		t.Fatalf("real calls = %d, cached = %v, cost = %v", n.Load(), r.Cached, r.CostUSD)
	}
	st := c.Meter.Snapshot()
	if st.Cheap.Calls != 1 || st.Cheap.CacheHits != 3 || st.TotalCostUSD != 0.0015 {
		t.Fatalf("meter: %+v", st)
	}
}

func TestEscalatesOnlyWhenInDoubt(t *testing.T) {
	cheap, expensive := &atomic.Int32{}, &atomic.Int32{}
	srv := fakeOpenRouter(t, map[string]*atomic.Int32{"cheap-m": cheap, "expensive-m": expensive})
	defer srv.Close()
	c := testClient(srv.URL)
	ctx := context.Background()

	r, escalated, err := c.CompleteWithEscalation(ctx, ask("easy"), func(Response) bool { return false })
	if err != nil || escalated || r.Tier != Cheap {
		t.Fatalf("must not escalate without doubt: %+v %v %v", r, escalated, err)
	}

	r, escalated, err = c.CompleteWithEscalation(ctx, ask("hard"), func(r Response) bool { return strings.Contains(r.Text, "cheap") })
	if err != nil || !escalated || r.Tier != Expensive || r.Text != "answer from expensive-m" {
		t.Fatalf("must escalate when in doubt: %+v %v %v", r, escalated, err)
	}
	if cheap.Load() != 2 || expensive.Load() != 1 {
		t.Fatalf("calls cheap=%d expensive=%d", cheap.Load(), expensive.Load())
	}
}

func TestEscalatesWhenCheapFails(t *testing.T) {
	srv := fakeOpenRouter(t, nil)
	defer srv.Close()
	c := testClient(srv.URL)
	c.Models[Cheap] = "broken"

	r, escalated, err := c.CompleteWithEscalation(context.Background(), ask("hello"), nil)
	if err != nil || !escalated || r.Tier != Expensive {
		t.Fatalf("should escalate after the error: %+v %v %v", r, escalated, err)
	}
	if st := c.Meter.Snapshot(); st.Cheap.Errors != 1 || st.Expensive.Calls != 1 {
		t.Fatalf("meter: %+v", st)
	}
}

func TestHTTPErrorHasMessageButNotKey(t *testing.T) {
	srv := fakeOpenRouter(t, nil)
	defer srv.Close()
	c := testClient(srv.URL)
	c.Models[Cheap] = "broken"

	_, err := c.Complete(context.Background(), ask("hello"))
	if err == nil || !strings.Contains(err.Error(), "model is down") || strings.Contains(err.Error(), "test-key") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNoAPIKey(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	if _, err := NewFromEnv(); err != ErrNoAPIKey {
		t.Fatalf("expected ErrNoAPIKey, got %v", err)
	}
}

func TestMultimodalAndJSONFormat(t *testing.T) {
	req := Request{
		System:   "You are an assistant.",
		JSON:     true,
		Messages: []Message{{Role: "user", Text: "What does it say?", Images: []string{"data:image/jpeg;base64,AAAA"}}},
	}
	data, _ := json.Marshal(toOpenRouter("m", req))
	s := string(data)
	for _, part := range []string{
		`"role":"system","content":"You are an assistant."`,
		`{"type":"text","text":"What does it say?"}`,
		`{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,AAAA"}}`,
		`"response_format":{"type":"json_object"}`,
		`"max_tokens":1024`,
	} {
		if !strings.Contains(s, part) {
			t.Errorf("missing %s in %s", part, s)
		}
	}
}

func TestCacheEvictsOldest(t *testing.T) {
	c := NewCache(2)
	c.Put("a", Response{Text: "a"})
	c.Put("b", Response{Text: "b"})
	c.Put("c", Response{Text: "c"})
	if _, ok := c.Get("a"); ok {
		t.Fatal("a should have been evicted")
	}
	if _, ok := c.Get("c"); !ok {
		t.Fatal("c is missing")
	}
}

func TestModelListTriesNextOnFailure(t *testing.T) {
	broken, good := &atomic.Int32{}, &atomic.Int32{}
	srv := fakeOpenRouter(t, map[string]*atomic.Int32{"broken": broken, "cheap-m": good})
	defer srv.Close()
	c := testClient(srv.URL)
	c.Models[Cheap] = "broken, cheap-m"

	r, err := c.Complete(context.Background(), ask("hello"))
	if err != nil || r.Model != "cheap-m" || broken.Load() != 1 || good.Load() != 1 {
		t.Fatalf("r=%+v err=%v broken=%d good=%d", r, err, broken.Load(), good.Load())
	}
	if st := c.Meter.Snapshot(); st.Cheap.Errors != 1 || st.Cheap.Calls != 1 {
		t.Fatalf("meter: %+v", st)
	}
}

func TestEmptyAnswerCountsAsFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":""}}],"usage":{"completion_tokens":300}}`))
	}))
	defer srv.Close()
	c := testClient(srv.URL)
	if _, err := c.Complete(context.Background(), ask("hello")); err == nil || !strings.Contains(err.Error(), "empty answer") {
		t.Fatalf("expected an empty-answer error, got %v", err)
	}
}

func TestDevProfileAndDotEnv(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	t.Setenv("OPENROUTER_API_KEY", "")
	os.Unsetenv("OPENROUTER_API_KEY")
	t.Setenv("LLM_PROFILE", "")
	os.Unsetenv("LLM_PROFILE")
	env := "# comment\nOPENROUTER_API_KEY=\"key-from-env\"\nexport LLM_PROFILE=dev\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := NewFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.APIKey != "key-from-env" || c.Models[Cheap] != DevCheapModels || c.Models[Expensive] != DevExpensiveModels {
		t.Fatalf("config: key=%q models=%v", c.APIKey, c.Models)
	}
	if !strings.HasPrefix(c.Models[Cheap], "nvidia/") || !strings.HasSuffix(c.Models[Cheap], DefaultCheapModel) {
		t.Fatalf("the dev profile must start with free models and end with the paid cheap one: %s", c.Models[Cheap])
	}
}

func TestDotEnvCandidatesIncludeCwdAndExecutableParents(t *testing.T) {
	c := DotEnvCandidates()
	if c[0] != ".env" || len(c) < 3 {
		t.Fatalf("candidates: %v", c)
	}
	exe, _ := os.Executable()
	if c[1] != filepath.Join(filepath.Dir(exe), ".env") {
		t.Fatalf("second candidate should be next to the executable: %v", c)
	}
}

func TestAudioPartAndModelsOverride(t *testing.T) {
	req := Request{Messages: []Message{{Role: "user", Text: "Transcribe", Audio: &Audio{Data: []byte("RIFF"), Format: "wav"}}}}
	data, _ := json.Marshal(toOpenRouter("m", req))
	if !strings.Contains(string(data), `{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}`) {
		t.Fatalf("audio part missing: %s", data)
	}

	used := map[string]*atomic.Int32{"audio-m": {}, "cheap-m": {}}
	srv := fakeOpenRouter(t, used)
	defer srv.Close()
	c := testClient(srv.URL)
	r, err := c.Complete(context.Background(), Request{Models: "broken,audio-m", Messages: req.Messages})
	if err != nil || r.Model != "audio-m" || r.Tier != Cheap || used["cheap-m"].Load() != 0 {
		t.Fatalf("override: %+v %v (cheap-m calls %d)", r, err, used["cheap-m"].Load())
	}
	if st := c.Meter.Snapshot(); st.Cheap.Calls != 1 || st.Cheap.Errors != 1 {
		t.Fatalf("cost must be counted under the tier: %+v", st)
	}
}
