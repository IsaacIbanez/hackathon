package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"
)

// ---------- Cache ----------

// Cache stores responses by exact request (model + messages + images).
// When full, it evicts the oldest entry.
type Cache struct {
	mu    sync.Mutex
	max   int
	items map[string]Response
	order []string
}

func NewCache(max int) *Cache {
	return &Cache{max: max, items: map[string]Response{}}
}

func (c *Cache) Get(key string) (Response, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r, ok := c.items[key]
	return r, ok
}

func (c *Cache) Put(key string, r Response) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.items[key]; ok {
		c.items[key] = r
		return
	}
	if c.max > 0 && len(c.order) >= c.max {
		delete(c.items, c.order[0])
		c.order = c.order[1:]
	}
	c.items[key] = r
	c.order = append(c.order, key)
}

func cacheKey(model string, req Request) string {
	req.Tier = "" // the model already identifies the tier
	data, _ := json.Marshal(struct {
		Model string
		Req   Request
	}{model, req})
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// ---------- Cost and latency meter ----------

// TierStats accumulates the calls of one tier.
type TierStats struct {
	Calls         int     `json:"calls"`     // real model calls
	CacheHits     int     `json:"cacheHits"` // answers served from the cache
	Errors        int     `json:"errors"`
	CostUSD       float64 `json:"costUsd"`
	AvgLatencyMs  int64   `json:"avgLatencyMs"`
	LastLatencyMs int64   `json:"lastLatencyMs"`
	totalLatency  time.Duration
}

// Stats is a snapshot of the meter. Its JSON is the payload of the "stats" message
// of the contract (api/openapi.yaml), so it can be sent to the UI as is.
type Stats struct {
	Cheap        TierStats `json:"cheap"`
	Expensive    TierStats `json:"expensive"`
	TotalCostUSD float64   `json:"totalCostUsd"`
}

// Meter counts calls, cost and latency. It is safe for concurrent use.
type Meter struct {
	mu    sync.Mutex
	tiers map[Tier]*TierStats
	// OnRecord, if not nil, is called after each record (for example, to push the stats to the UI).
	OnRecord func(Stats)
}

func (m *Meter) tier(t Tier) *TierStats {
	if m.tiers == nil {
		m.tiers = map[Tier]*TierStats{}
	}
	s, ok := m.tiers[t]
	if !ok {
		s = &TierStats{}
		m.tiers[t] = s
	}
	return s
}

// Record registers a response (real or cached).
func (m *Meter) Record(r Response) {
	m.mu.Lock()
	s := m.tier(r.Tier)
	if r.Cached {
		s.CacheHits++
	} else {
		s.Calls++
		s.CostUSD += r.CostUSD
		s.totalLatency += r.Latency
		s.LastLatencyMs = r.Latency.Milliseconds()
		s.AvgLatencyMs = (s.totalLatency / time.Duration(s.Calls)).Milliseconds()
	}
	m.mu.Unlock()
	m.notify()
}

// RecordError registers a failed call.
func (m *Meter) RecordError(t Tier) {
	m.mu.Lock()
	m.tier(t).Errors++
	m.mu.Unlock()
	m.notify()
}

// Snapshot returns a copy of the current state.
func (m *Meter) Snapshot() Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Stats{Cheap: *m.tier(Cheap), Expensive: *m.tier(Expensive)}
	st.TotalCostUSD = st.Cheap.CostUSD + st.Expensive.CostUSD
	return st
}

func (m *Meter) notify() {
	if m.OnRecord != nil {
		m.OnRecord(m.Snapshot())
	}
}
