package api

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// Comprueba que cada fixture encaja en el sobre y en su tipo de mensaje.
func TestFixturesEncajanEnElContrato(t *testing.T) {
	casos := map[string]gen.MessageType{
		"document.json":        "document",
		"pointer.json":         "pointer",
		"utterance.json":       "utterance",
		"speak.json":           "speak",
		"speak-utterance.json": "speak",
		"stats.json":           "stats",
	}
	for archivo, tipo := range casos {
		t.Run(archivo, func(t *testing.T) {
			datos, err := Fixtures.ReadFile("fixtures/" + archivo)
			if err != nil {
				t.Fatal(err)
			}
			var env gen.Envelope
			if err := json.Unmarshal(datos, &env); err != nil {
				t.Fatalf("sobre: %v", err)
			}
			if env.Type != tipo || env.Id == "" || env.Ts == 0 || len(env.Payload) == 0 {
				t.Fatalf("sobre incompleto: %+v", env)
			}
			if !env.Type.Valid() {
				t.Fatalf("tipo no válido: %q", env.Type)
			}

			var payload any
			switch tipo {
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
			// Campos desconocidos = errata en la fixture o contrato desactualizado.
			dec := json.NewDecoder(bytes.NewReader(env.Payload))
			dec.DisallowUnknownFields()
			if err := dec.Decode(payload); err != nil {
				t.Fatalf("payload: %v", err)
			}
		})
	}
}
