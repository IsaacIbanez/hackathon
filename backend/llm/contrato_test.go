package llm

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// El JSON de Meter.Snapshot() debe ser exactamente el payload del mensaje stats del contrato,
// para poder enviarlo tal cual a la UI.
func TestStatsEncajaEnElContrato(t *testing.T) {
	m := &Meter{}
	m.Record(Response{Tier: Barato, CostUSD: 0.001, Latency: 800e6})
	m.Record(Response{Tier: Barato, Cached: true})
	m.RecordError(Caro)

	datos, err := json.Marshal(m.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(datos))
	dec.DisallowUnknownFields()
	var p gen.StatsPayload
	if err := dec.Decode(&p); err != nil {
		t.Fatalf("Stats no encaja en StatsPayload: %v\n%s", err, datos)
	}
	if p.Barato.Calls != 1 || p.Barato.CacheHits != 1 || p.Caro.Errors != 1 || p.TotalCostUsd != 0.001 || p.Barato.AvgLatencyMs != 800 {
		t.Fatalf("valores: %+v", p)
	}
}
