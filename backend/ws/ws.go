// Package ws serves the /ws WebSocket: it reads contract envelopes (api/openapi.yaml)
// and hands each message to a Handler or to a per-connection Session.
// Used by the mock and by the Wails app.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// MaxMessageBytes is the maximum size of an incoming message. The library default
// (32 KB) is too small for a full-page document.
const MaxMessageBytes = 4 << 20

// Handler receives a client message and returns zero or more replies.
// Each reply is serialized to JSON as is (usually a gen.SpeakMessage or gen.StatsMessage).
// It is stateless: use Session when state per connection is needed.
type Handler func(ctx context.Context, msg gen.Envelope) []any

// Session handles messages and keeps their state. Served by Server, there is one Session
// per connection and Handle is called from a single goroutine; shared by a Hub, Handle may
// be called concurrently from several clients, so implementations must be goroutine-safe.
// send can be called at any time, from any goroutine, until ctx is done; it serializes v
// to JSON.
type Session interface {
	Handle(ctx context.Context, msg gen.Envelope, send func(v any))
}

// Server is an http.Handler that accepts WebSocket connections.
// Set either NewSession (preferred) or Handle.
type Server struct {
	NewSession func() Session
	Handle     Handler
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
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	var mu sync.Mutex
	send := func(v any) {
		mu.Lock()
		defer mu.Unlock()
		if ctx.Err() != nil {
			return
		}
		if err := wsjson.Write(ctx, conn, v); err != nil {
			log.Printf("ws: write: %v", err)
			cancel()
		}
	}

	var sess Session
	if s.NewSession != nil {
		sess = s.NewSession()
	}

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
			log.Printf("ws: ignored message (does not fit the envelope): %.200s", data)
			continue
		}
		if sess != nil {
			sess.Handle(ctx, msg, send)
			continue
		}
		for _, resp := range s.Handle(ctx, msg) {
			send(resp)
		}
	}
}
