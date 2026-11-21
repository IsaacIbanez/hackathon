package scanner

import (
	"context"
	"encoding/json"

	"github.com/IsaacIbanez/hackathon/api"
	"github.com/IsaacIbanez/hackathon/api/gen"
)

// Fixture answers every scan with api/fixtures/document.json (a sample form with
// pageCorners), so the whole "lee el documento" flow can be tried without the reading
// service: set SCANNER_URL=fixture.
type Fixture struct{}

func (Fixture) Scan(context.Context, []byte, string) (gen.DocumentPayload, error) {
	var m gen.DocumentMessage
	data, err := api.Fixtures.ReadFile("fixtures/document.json")
	if err != nil {
		return gen.DocumentPayload{}, err
	}
	err = json.Unmarshal(data, &m)
	return m.Payload, err
}
