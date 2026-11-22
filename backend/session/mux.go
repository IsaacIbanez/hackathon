package session

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/captions"
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
//	POST /transcribe?lang=es-ES  a WAV recording -> {"text": ...} (cloud backup of the voice)
//	GET  /captions WebSocket: live captions with speakers and translation (backend/captions)
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
	mux.HandleFunc("POST /transcribe", func(w http.ResponseWriter, r *http.Request) {
		handleTranscribe(w, r, sess, hub)
	})
	mux.Handle("GET /captions", captions.New(captions.FromEnv(), OriginPatterns))
	return ws.Guard(mux, OriginPatterns), hub
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

// MaxAudioBytes bounds a recording sent to POST /transcribe (~5 min of 16 kHz mono WAV).
const MaxAudioBytes = 10 << 20

// Transcription is the answer of POST /transcribe.
type Transcription struct {
	Text      string  `json:"text"`
	Model     string  `json:"model"`
	CostUSD   float64 `json:"costUsd"`
	LatencyMs int64   `json:"latencyMs"`
}

func handleTranscribe(w http.ResponseWriter, r *http.Request, sess *Session, hub *ws.Hub) {
	w.Header().Set("Content-Type", "application/json")
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "audio/wav" && ct != "audio/x-wav" && ct != "audio/wave" {
		w.WriteHeader(http.StatusUnsupportedMediaType)
		_, _ = io.WriteString(w, `{"ok":false,"error":"send the recording as audio/wav (16 kHz mono is enough)"}`)
		return
	}
	wav, err := io.ReadAll(io.LimitReader(r.Body, MaxAudioBytes+1))
	switch {
	case err != nil || len(wav) == 0:
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"ok":false,"error":"empty or unreadable recording"}`)
		return
	case len(wav) > MaxAudioBytes:
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_, _ = io.WriteString(w, `{"ok":false,"error":"recording larger than 10 MB"}`)
		return
	}
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "es-ES"
	}
	resp, err := sess.Transcribe(r.Context(), wav, lang, hub.Broadcast)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(Transcription{Text: resp.Text, Model: resp.Model, CostUSD: resp.CostUSD, LatencyMs: resp.LatencyMs})
}
