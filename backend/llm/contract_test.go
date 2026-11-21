package llm

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// The JSON of Meter.Snapshot() must be exactly the payload of the contract's stats message,
// so it can be sent to the UI as is.
func TestStatsMatchesContract(t *testing.T) {
	m := &Meter{}
	m.Record(Response{Tier: Cheap, CostUSD: 0.001, Latency: 800e6})
	m.Record(Response{Tier: Cheap, Cached: true})
	m.RecordError(Expensive)

	data, err := json.Marshal(m.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var p gen.StatsPayload
	if err := dec.Decode(&p); err != nil {
		t.Fatalf("Stats does not match StatsPayload: %v\n%s", err, data)
	}
	if p.Cheap.Calls != 1 || p.Cheap.CacheHits != 1 || p.Expensive.Errors != 1 || p.TotalCostUsd != 0.001 || p.Cheap.AvgLatencyMs != 800 {
		t.Fatalf("values: %+v", p)
	}
}
