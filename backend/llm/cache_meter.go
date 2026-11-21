package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"
)

// ---------- Caché ----------

// Cache guarda respuestas por petición exacta (modelo + mensajes + imágenes).
// Cuando se llena, borra la entrada más antigua.
type Cache struct {
	mu    sync.Mutex
	max   int
	items map[string]Response
	orden []string
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
	if c.max > 0 && len(c.orden) >= c.max {
		delete(c.items, c.orden[0])
		c.orden = c.orden[1:]
	}
	c.items[key] = r
	c.orden = append(c.orden, key)
}

func cacheKey(model string, req Request) string {
	req.Tier = "" // el modelo ya identifica el nivel
	datos, _ := json.Marshal(struct {
		Model string
		Req   Request
	}{model, req})
	h := sha256.Sum256(datos)
	return hex.EncodeToString(h[:])
}

// ---------- Contador de coste y latencia ----------

// TierStats acumula las llamadas de un nivel.
type TierStats struct {
	Calls         int     `json:"calls"`     // llamadas reales al modelo
	CacheHits     int     `json:"cacheHits"` // respuestas servidas desde la caché
	Errors        int     `json:"errors"`
	CostUSD       float64 `json:"costUsd"`
	AvgLatencyMs  int64   `json:"avgLatencyMs"`
	LastLatencyMs int64   `json:"lastLatencyMs"`
	totalLatency  time.Duration
}

// Stats es la foto del contador; está pensada para mostrarse en la UI.
type Stats struct {
	Barato       TierStats `json:"barato"`
	Caro         TierStats `json:"caro"`
	TotalCostUSD float64   `json:"totalCostUsd"`
}

// Meter cuenta llamadas, coste y latencia. Es seguro para varias goroutines.
type Meter struct {
	mu    sync.Mutex
	tiers map[Tier]*TierStats
	// OnRecord, si no es nil, se llama tras cada registro (por ejemplo, para enviar las stats a la UI).
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

// Record anota una respuesta (real o de caché).
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

// RecordError anota una llamada fallida.
func (m *Meter) RecordError(t Tier) {
	m.mu.Lock()
	m.tier(t).Errors++
	m.mu.Unlock()
	m.notify()
}

// Snapshot devuelve una copia del estado actual.
func (m *Meter) Snapshot() Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Stats{Barato: *m.tier(Barato), Caro: *m.tier(Caro)}
	st.TotalCostUSD = st.Barato.CostUSD + st.Caro.CostUSD
	return st
}

func (m *Meter) notify() {
	if m.OnRecord != nil {
		m.OnRecord(m.Snapshot())
	}
}
