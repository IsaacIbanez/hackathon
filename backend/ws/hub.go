package ws

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// Hub shares ONE Session among every client of the app and broadcasts whatever the
// session sends to all connected WebSocket clients.
//
// It is a desktop app for one person: the UI (gestures, voice, screen) and the scanner
// (a separate local process) must see the same document and the same answers. A client can
// talk to the session through the WebSocket (ServeHTTP) or with a plain HTTP POST of one
// envelope (HandlePost), which is easy from Python with the standard library.
type Hub struct {
	sess Session
	// OriginPatterns allows extra browser origins on the WebSocket.
	OriginPatterns []string

	ctx    context.Context // lives as long as the hub, not as one connection
	cancel context.CancelFunc

	mu      sync.Mutex
	clients map[*hubClient]struct{}
}

type hubClient struct {
	conn *websocket.Conn
	mu   sync.Mutex // one writer at a time
}

// writeTimeout bounds each broadcast write so a stuck client cannot block the others.
const writeTimeout = 5 * time.Second

// NewHub creates a hub around one shared session.
func NewHub(sess Session, originPatterns []string) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	return &Hub{sess: sess, OriginPatterns: originPatterns, ctx: ctx, cancel: cancel, clients: map[*hubClient]struct{}{}}
}

// Context lives as long as the hub: use it for work started on the session's behalf
// (for example, a scan triggered by POST /scan) so it is not cancelled with one request.
func (h *Hub) Context() context.Context { return h.ctx }

// Close cancels the session's pending work (model calls). Connections close with the server.
func (h *Hub) Close() { h.cancel() }

// Clients returns how many WebSocket clients are connected.
func (h *Hub) Clients() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// Broadcast sends v to every connected WebSocket client. Clients that fail are dropped.
func (h *Hub) Broadcast(v any) {
	h.mu.Lock()
	clients := make([]*hubClient, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()

	for _, c := range clients {
		c.mu.Lock()
		ctx, cancel := context.WithTimeout(h.ctx, writeTimeout)
		err := wsjson.Write(ctx, c.conn, v)
		cancel()
		c.mu.Unlock()
		if err != nil {
			log.Printf("ws: dropping client: %v", err)
			h.remove(c)
			c.conn.CloseNow()
		}
	}
}

func (h *Hub) remove(c *hubClient) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

// handle passes one envelope to the shared session; replies go to everyone.
func (h *Hub) handle(data []byte) bool {
	var msg gen.Envelope
	if err := json.Unmarshal(data, &msg); err != nil || !msg.Type.Valid() {
		log.Printf("ws: ignored message (does not fit the envelope): %.200s", data)
		return false
	}
	h.sess.Handle(h.ctx, msg, h.Broadcast)
	return true
}

// ServeHTTP accepts a WebSocket client.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.OriginPatterns})
	if err != nil {
		log.Printf("ws: accept: %v", err)
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(MaxMessageBytes)

	c := &hubClient{conn: conn}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	defer h.remove(c)

	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == -1 && ctx.Err() == nil {
				log.Printf("ws: read: %v", err)
			}
			return
		}
		h.handle(data)
	}
}

// HandlePost accepts one envelope as the body of POST /message and answers 202 Accepted.
// The session's replies are broadcast to the WebSocket clients (the UI), not returned here.
func (h *Hub) HandlePost(w http.ResponseWriter, r *http.Request) {
	// JSON only: a cross-site form or text/plain POST cannot send it without a CORS preflight.
	if ct, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";"); strings.TrimSpace(ct) != "application/json" {
		http.Error(w, `{"ok":false,"error":"send the envelope as application/json"}`, http.StatusUnsupportedMediaType)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, MaxMessageBytes+1))
	if err != nil || len(data) > MaxMessageBytes {
		http.Error(w, `{"ok":false,"error":"body too large or unreadable"}`, http.StatusRequestEntityTooLarge)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.handle(data) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"ok":false,"error":"not a contract envelope (see api/openapi.yaml)"}`)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	_, _ = io.WriteString(w, `{"ok":true}`)
}
