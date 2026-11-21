// Real server without the Wails window: go run ./backend/cmd/server
//
// Same logic as the desktop app (backend/session + backend/llm) on 127.0.0.1:8765, so the
// scanner (Python) or the frontend (npm run dev with VITE_WS_URL) can be tested against it.
// Needs OPENROUTER_API_KEY (environment or .env); use LLM_PROFILE=dev while developing.
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/IsaacIbanez/hackathon/backend/llm"
	"github.com/IsaacIbanez/hackathon/backend/session"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

func main() {
	addr := flag.String("addr", ws.DefaultAddr, "listen address")
	flag.Parse()

	client, err := llm.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("cheap=%s expensive=%s", client.Models[llm.Cheap], client.Models[llm.Expensive])
	log.Printf("listening on http://%s (GET /health, WebSocket ws://%s/ws)", *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, session.NewMux(client, session.DefaultConfig())))
}
