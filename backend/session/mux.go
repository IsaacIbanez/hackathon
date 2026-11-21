package session

import (
	"encoding/json"
	"net/http"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// OriginPatterns are the browser origins allowed on /ws: Vite, wails dev/build on Windows
// (wails.localhost) and on Linux/macOS (wails://wails). Non-browser clients need none.
var OriginPatterns = []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"}

// NewMux returns an http.Handler with GET /health and /ws backed by real sessions.
func NewMux(model Model, cfg Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gen.Health{Status: "ok"})
	})
	mux.Handle("/ws", NewServer(model, cfg, OriginPatterns))
	return mux
}
