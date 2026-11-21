package session

import (
	"encoding/json"
	"net/http"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

// OriginPatterns are the browser origins allowed on /ws: Vite, wails dev/build on Windows
// (wails.localhost) and on Linux/macOS (wails://wails). Non-browser clients need none.
var OriginPatterns = []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"}

// NewMux returns the app's HTTP API backed by ONE shared session (see ws.Hub):
//
//	GET  /health   liveness
//	GET  /ws       WebSocket: send contract messages, receive every speak and stats
//	POST /message  one contract envelope as the body (for the scanner); answers 202
//
// The hub is returned so the caller can Close it on shutdown.
func NewMux(model Model, cfg Config) (http.Handler, *ws.Hub) {
	hub := ws.NewHub(New(model, cfg), OriginPatterns)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gen.Health{Status: "ok"})
	})
	mux.Handle("/ws", hub)
	mux.HandleFunc("POST /message", hub.HandlePost)
	return mux, hub
}
