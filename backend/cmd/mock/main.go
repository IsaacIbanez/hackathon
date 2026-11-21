// Servidor mock sin Wails: go run ./backend/cmd/mock
//
// Responde con las fixtures de api/fixtures:
//   - document  -> speak.json
//   - utterance -> speak-utterance.json (solo si isFinal)
//   - pointer   -> nada (solo lo registra)
package main

import (
	"flag"
	"log"
	"net/http"
)

func main() {
	addr := flag.String("addr", "localhost:8080", "dirección de escucha")
	flag.Parse()

	h, err := newMux()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("mock escuchando en http://%s (GET /health, WebSocket ws://%s/ws)", *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, h))
}
