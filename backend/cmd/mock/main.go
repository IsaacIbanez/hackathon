// Servidor mock sin Wails: go run ./backend/cmd/mock
// Responde con las fixtures de api/fixtures (ver backend/mock).
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/IsaacIbanez/hackathon/backend/mock"
)

func main() {
	addr := flag.String("addr", "localhost:8080", "dirección de escucha")
	flag.Parse()

	h, err := mock.NewMux()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("mock escuchando en http://%s (GET /health, WebSocket ws://%s/ws)", *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, h))
}
