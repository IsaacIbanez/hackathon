package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/IsaacIbanez/hackathon/api"
	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

func cargarSpeak(nombre string) (gen.SpeakMessage, error) {
	var m gen.SpeakMessage
	datos, err := api.Fixtures.ReadFile("fixtures/" + nombre)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(datos, &m); err != nil {
		return m, fmt.Errorf("%s: %w", nombre, err)
	}
	return m, nil
}

// responder copia la fixture y le pone id, ts y replyTo nuevos.
func responder(plantilla gen.SpeakMessage, a gen.Envelope) gen.SpeakMessage {
	m := plantilla
	m.Ts = time.Now().UnixMilli()
	m.Id = fmt.Sprintf("spk-%d", m.Ts)
	replyTo := a.Id
	m.Payload.ReplyTo = &replyTo
	return m
}

func newMux() (http.Handler, error) {
	speakDoc, err := cargarSpeak("speak.json")
	if err != nil {
		return nil, err
	}
	speakUtt, err := cargarSpeak("speak-utterance.json")
	if err != nil {
		return nil, err
	}

	handle := func(_ context.Context, msg gen.Envelope) []any {
		log.Printf("recibido %s (%s): %s", msg.Type, msg.Id, msg.Payload)
		switch msg.Type {
		case "document":
			return []any{responder(speakDoc, msg)}
		case "utterance":
			var p gen.UtterancePayload
			if err := json.Unmarshal(msg.Payload, &p); err == nil && p.IsFinal {
				return []any{responder(speakUtt, msg)}
			}
		}
		return nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gen.Health{Status: "ok"})
	})
	// Orígenes extra: Vite, wails dev/build en Windows (wails.localhost) y en Linux/macOS (wails://wails).
	mux.Handle("/ws", &ws.Server{Handle: handle, OriginPatterns: []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"}})
	return mux, nil
}
