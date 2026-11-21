// Mock server without Wails: go run ./backend/cmd/mock
// Answers with the fixtures in api/fixtures (see backend/mock).
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/IsaacIbanez/hackathon/backend/mock"
)

func main() {
	addr := flag.String("addr", "localhost:8080", "listen address")
	flag.Parse()

	h, err := mock.NewMux()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("mock listening on http://%s (GET /health, WebSocket ws://%s/ws)", *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, h))
}
