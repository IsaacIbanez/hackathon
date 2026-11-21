// Package ws sirve el WebSocket /ws: lee sobres del contrato (api/openapi.yaml)
// y delega cada mensaje en un Handler. Lo usan el mock y, más adelante, la app Wails.
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

// MaxMessageBytes es el tamaño máximo de un mensaje entrante. El límite por defecto
// de la librería (32 KB) se queda corto para un document de una página entera.
const MaxMessageBytes = 4 << 20

// Handler recibe un mensaje del cliente y devuelve cero o más respuestas.
// Cada respuesta se serializa a JSON tal cual (normalmente un gen.SpeakMessage).
type Handler func(ctx context.Context, msg gen.Envelope) []any

// Server es un http.Handler que acepta conexiones WebSocket.
type Server struct {
	Handle Handler
	// OriginPatterns permite orígenes extra (por ejemplo "localhost:*" para Vite).
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
				log.Printf("ws: lectura: %v", err)
			}
			return
		}
		var msg gen.Envelope
		if err := json.Unmarshal(data, &msg); err != nil || !msg.Type.Valid() {
			log.Printf("ws: mensaje ignorado (no encaja en el sobre): %s", data)
			continue
		}
		for _, resp := range s.Handle(ctx, msg) {
			if err := wsjson.Write(ctx, conn, resp); err != nil {
				log.Printf("ws: escritura: %v", err)
				return
			}
		}
	}
}
