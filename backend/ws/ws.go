// Package ws serves the /ws WebSocket: it reads contract envelopes (api/openapi.yaml)
// and hands each message to a Handler. Used by the mock and by the Wails app.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// MaxMessageBytes is the maximum size of an incoming message. The library default
// (32 KB) is too small for a full-page document.
const MaxMessageBytes = 4 << 20

// Handler receives a client message and returns zero or more replies.
// Each reply is serialized to JSON as is (usually a gen.SpeakMessage or gen.StatsMessage).
type Handler func(ctx context.Context, msg gen.Envelope) []any

// Server is an http.Handler that accepts WebSocket connections.
type Server struct {
	Handle Handler
	// OriginPatterns allows extra browser origins (for example "localhost:*" for Vite).
	// Non-browser clients (no Origin header) are always accepted.
	OriginPatterns []string
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.OriginPatterns})
	if err != nil {
		log.Printf("ws: accept: %v", err)
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(MaxMessageBytes)
	ctx := r.Context()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == -1 && ctx.Err() == nil {
				log.Printf("ws: read: %v", err)
			}
			return
		}
		var msg gen.Envelope
		if err := json.Unmarshal(data, &msg); err != nil || !msg.Type.Valid() {
			log.Printf("ws: ignored message (does not fit the envelope): %s", data)
			continue
		}
		for _, resp := range s.Handle(ctx, msg) {
			if err := wsjson.Write(ctx, conn, resp); err != nil {
				log.Printf("ws: write: %v", err)
				return
			}
		}
	}
}
