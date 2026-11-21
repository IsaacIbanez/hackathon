package session

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/scanner"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

// OriginPatterns are the browser origins allowed on /ws: Vite, wails dev/build on Windows
// (wails.localhost) and on Linux/macOS (wails://wails). Non-browser clients need none.
var OriginPatterns = []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"}

// MaxPhotoBytes bounds a photo sent to POST /scan (a 4K PNG is ~10-25 MB).
const MaxPhotoBytes = 40 << 20

// NewMux returns the app's HTTP API backed by ONE shared session (see ws.Hub):
//
//	GET  /health   liveness
//	GET  /ws       WebSocket: send contract messages, receive every document, speak and stats
//	POST /message  one contract envelope as the body (for the scanner); answers 202
//	POST /scan     a camera photo: Go has it read by the reading service; answers 202
//
// The hub is returned so the caller can Close it on shutdown.
func NewMux(model Model, cfg Config) (http.Handler, *ws.Hub) {
	if cfg.Scanner == nil {
		cfg.Scanner = scanner.FromEnv()
	}
	sess := New(model, cfg)
	hub := ws.NewHub(sess, OriginPatterns)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gen.Health{Status: "ok"})
	})
	mux.Handle("/ws", hub)
	mux.HandleFunc("POST /message", hub.HandlePost)
	mux.HandleFunc("POST /scan", func(w http.ResponseWriter, r *http.Request) {
		handleScan(w, r, sess, hub)
	})
	return mux, hub
}

func handleScan(w http.ResponseWriter, r *http.Request, sess *Session, hub *ws.Hub) {
	w.Header().Set("Content-Type", "application/json")
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "image/jpeg" && ct != "image/png" && ct != "image/webp" {
		w.WriteHeader(http.StatusUnsupportedMediaType)
		_, _ = io.WriteString(w, `{"ok":false,"error":"send the photo as image/jpeg, image/png or image/webp"}`)
		return
	}
	photo, err := io.ReadAll(io.LimitReader(r.Body, MaxPhotoBytes+1))
	switch {
	case err != nil:
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"ok":false,"error":"could not read the photo"}`)
		return
	case len(photo) > MaxPhotoBytes:
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_, _ = io.WriteString(w, `{"ok":false,"error":"photo larger than 40 MB"}`)
		return
	case len(photo) == 0:
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"ok":false,"error":"empty body"}`)
		return
	}
	// The scan takes seconds (OCR): answer now, results go to every WebSocket client.
	go sess.ScanPhoto(hub.Context(), photo, ct, hub.Broadcast)
	w.WriteHeader(http.StatusAccepted)
	_, _ = io.WriteString(w, `{"ok":true}`)
}
