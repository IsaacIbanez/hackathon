package api

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// Checks that each fixture fits the envelope and its message type.
func TestFixturesMatchContract(t *testing.T) {
	cases := map[string]gen.MessageType{
		"document.json":        "document",
		"pointer.json":         "pointer",
		"utterance.json":       "utterance",
		"speak.json":           "speak",
		"speak-utterance.json": "speak",
		"stats.json":           "stats",
	}
	for file, msgType := range cases {
		t.Run(file, func(t *testing.T) {
			data, err := Fixtures.ReadFile("fixtures/" + file)
			if err != nil {
				t.Fatal(err)
			}
			var env gen.Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				t.Fatalf("envelope: %v", err)
			}
			if env.Type != msgType || env.Id == "" || env.Ts == 0 || len(env.Payload) == 0 {
				t.Fatalf("incomplete envelope: %+v", env)
			}
			if !env.Type.Valid() {
				t.Fatalf("invalid type: %q", env.Type)
			}

			var payload any
			switch msgType {
			case "document":
				var p gen.DocumentPayload
				payload = &p
			case "pointer":
				var p gen.PointerPayload
				payload = &p
			case "utterance":
				var p gen.UtterancePayload
				payload = &p
			case "speak":
				var p gen.SpeakPayload
				payload = &p
			case "stats":
				var p gen.StatsPayload
				payload = &p
			}
			// Unknown fields = a typo in the fixture or an outdated contract.
			dec := json.NewDecoder(bytes.NewReader(env.Payload))
			dec.DisallowUnknownFields()
			if err := dec.Decode(payload); err != nil {
				t.Fatalf("payload: %v", err)
			}
		})
	}
}
