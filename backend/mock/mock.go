// Package mock answers contract messages with the fixtures in api/fixtures:
//   - document  -> the same document (echo) + speak.json + stats.json
//   - utterance -> speak-utterance.json + stats.json (only if isFinal)
//   - pointer   -> nothing (only logged)
//
// Used by the mock server (backend/cmd/mock) and by the Wails app until the real logic exists (T8).
package mock

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

func load[T any](name string) (T, error) {
	var m T
	data, err := api.Fixtures.ReadFile("fixtures/" + name)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, fmt.Errorf("%s: %w", name, err)
	}
	return m, nil
}

// reply copies the fixture and gives it a new id, ts and replyTo.
func reply(template gen.SpeakMessage, to gen.Envelope) gen.SpeakMessage {
	m := template
	m.Ts = time.Now().UnixMilli()
	m.Id = fmt.Sprintf("spk-%d", m.Ts)
	replyTo := to.Id
	m.Payload.ReplyTo = &replyTo
	return m
}

// NewMux returns an http.Handler with GET /health and the /ws WebSocket.
func NewMux() (http.Handler, error) {
	speakDoc, err := load[gen.SpeakMessage]("speak.json")
	if err != nil {
		return nil, err
	}
	speakUtt, err := load[gen.SpeakMessage]("speak-utterance.json")
	if err != nil {
		return nil, err
	}
	stats, err := load[gen.StatsMessage]("stats.json")
	if err != nil {
		return nil, err
	}
	// Like the real app: after each model answer, the updated meter.
	withStats := func(s gen.SpeakMessage) []any {
		st := stats
		st.Ts = s.Ts
		st.Id = fmt.Sprintf("sts-%d", st.Ts)
		return []any{s, st}
	}

	handle := func(_ context.Context, msg gen.Envelope) []any {
		log.Printf("received %s (%s, %d bytes)", msg.Type, msg.Id, len(msg.Payload))
		switch msg.Type {
		case "document":
			var doc gen.DocumentMessage
			if err := json.Unmarshal(msg.Payload, &doc.Payload); err != nil {
				return nil
			}
			doc.Type, doc.Id, doc.Ts = "document", msg.Id, time.Now().UnixMilli()
			return append([]any{doc}, withStats(reply(speakDoc, msg))...)
		case "utterance":
			var p gen.UtterancePayload
			if err := json.Unmarshal(msg.Payload, &p); err == nil && p.IsFinal {
				return withStats(reply(speakUtt, msg))
			}
		}
		return nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gen.Health{Status: "ok"})
	})
	// Extra origins: Vite, wails dev/build on Windows (wails.localhost) and on Linux/macOS (wails://wails).
	mux.Handle("/ws", &ws.Server{Handle: handle, OriginPatterns: []string{"localhost:*", "127.0.0.1:*", "wails.localhost*", "wails"}})
	return mux, nil
}
