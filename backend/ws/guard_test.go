package ws

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGuard(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	g := Guard(ok, []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"})

	cases := []struct {
		name, method, host, origin string
		want                       int
	}{
		{"local process, no origin (scanner)", "POST", "127.0.0.1:8765", "", http.StatusTeapot},
		{"localhost host", "POST", "localhost:8765", "", http.StatusTeapot},
		{"DNS rebinding: foreign Host", "POST", "evil.example:8765", "", http.StatusForbidden},
		{"foreign website", "POST", "127.0.0.1:8765", "https://evil.example", http.StatusForbidden},
		{"Vite dev server", "POST", "127.0.0.1:8765", "http://localhost:5173", http.StatusTeapot},
		{"Wails on Windows", "POST", "127.0.0.1:8765", "http://wails.localhost", http.StatusTeapot},
		{"Wails on Linux/macOS", "POST", "127.0.0.1:8765", "wails://wails", http.StatusTeapot},
		{"CORS preflight from the app", "OPTIONS", "127.0.0.1:8765", "http://localhost:5173", http.StatusNoContent},
		{"CORS preflight from a website", "OPTIONS", "127.0.0.1:8765", "https://evil.example", http.StatusForbidden},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, "/scan", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		rec := httptest.NewRecorder()
		g.ServeHTTP(rec, r)
		if rec.Code != c.want {
			t.Errorf("%s: got %d, want %d", c.name, rec.Code, c.want)
		}
		if c.want != http.StatusForbidden && c.origin != "" && rec.Header().Get("Access-Control-Allow-Origin") != c.origin {
			t.Errorf("%s: missing CORS header", c.name)
		}
	}
}
