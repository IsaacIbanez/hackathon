// Package session is the real logic behind the app's API: one shared Session keeps the
// last document and turns contract messages into spoken answers.
//
// Frugality (AXA): framing problems, pointed blocks and "no document yet" are answered
// locally at no cost; only explanations and questions go to the model, cheap tier first.
// When to escalate to the expensive tier is Config.Doubt, owned by role B2.
package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/llm"
)

// Model is what the session needs from backend/llm (an interface so tests can fake it).
type Model interface {
	CompleteWithEscalation(ctx context.Context, req llm.Request, doubt func(llm.Response) bool) (llm.Response, bool, error)
	Stats() llm.Stats
}

// Config tunes the session. The zero value is not valid: use DefaultConfig.
type Config struct {
	// MinQuality: below this frame quality score the session only gives framing advice
	// and does not call the model.
	MinQuality float32
	// Doubt decides whether the cheap model's answer is good enough. Placeholder
	// criterion until role B2 provides theirs: see DefaultDoubt.
	Doubt func(doc *gen.DocumentPayload, r llm.Response) bool
	// ModelTimeout bounds each model call.
	ModelTimeout time.Duration
	// MaxTokens for each model call (reasoning models spend part of them thinking).
	MaxTokens int
}

// DefaultConfig returns the configuration used by the app.
func DefaultConfig() Config {
	return Config{MinQuality: 0.5, Doubt: DefaultDoubt, ModelTimeout: 45 * time.Second, MaxTokens: 1500}
}

// Session holds the conversation state (last document, pointed block). It implements
// ws.Session and is goroutine-safe: the app shares one Session among all its clients.
type Session struct {
	model Model
	cfg   Config

	mu          sync.Mutex
	doc         *gen.DocumentPayload // last usable document
	lastPointed string               // last block read aloud by pointing
	cancelJob   context.CancelFunc   // model call in flight, if any
	seq         atomic.Int64
}

// New creates a session.
func New(model Model, cfg Config) *Session {
	return &Session{model: model, cfg: cfg}
}

// Handle implements ws.Session.
func (s *Session) Handle(ctx context.Context, msg gen.Envelope, send func(any)) {
	switch msg.Type {
	case "document":
		var p gen.DocumentPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			log.Printf("session: bad document: %v", err)
			return
		}
		s.onDocument(ctx, msg.Id, &p, send)
	case "pointer":
		var p gen.PointerPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			return
		}
		s.onPointer(msg.Id, &p, send)
	case "utterance":
		var p gen.UtterancePayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			return
		}
		s.onUtterance(ctx, msg.Id, &p, send)
	}
}

func (s *Session) onDocument(ctx context.Context, id string, doc *gen.DocumentPayload, send func(any)) {
	lang := speechLang(deref(doc.Lang))
	if hint, ok := framingHint(doc, s.cfg.MinQuality, lang); ok {
		send(s.speak(id, hint, nil, lang))
		return
	}

	s.mu.Lock()
	s.doc = doc
	s.lastPointed = ""
	s.mu.Unlock()

	req := llm.Request{
		System:    systemPrompt,
		Messages:  []llm.Message{{Role: "user", Text: explainPrompt(doc)}},
		MaxTokens: s.cfg.MaxTokens,
		JSON:      true,
	}
	s.ask(ctx, id, doc, req, lang, send)
}

func (s *Session) onPointer(id string, p *gen.PointerPayload, send func(any)) {
	s.mu.Lock()
	doc := s.doc
	var block *gen.TextBlock
	if doc != nil {
		// The client may send only coordinates (the gesture bridge does): find the block here.
		blockID := deref(p.BlockId)
		if blockID == "" {
			blockID = blockAt(doc, p.X, p.Y)
		}
		if blockID != "" && blockID != s.lastPointed {
			for i := range doc.Blocks {
				if doc.Blocks[i].Id == blockID {
					block = &doc.Blocks[i]
					s.lastPointed = blockID
					break
				}
			}
		}
	}
	s.mu.Unlock()
	if block != nil {
		send(s.speak(id, block.Text, []string{block.Id}, speechLang(deref(doc.Lang))))
	}
}

// pointerMargin lets a fingertip slightly outside a box still select it.
const pointerMargin = 0.01

// blockAt returns the id of the block under (x, y), or "" if none. When boxes overlap,
// the smallest one wins (it is the most specific: a field inside a section).
func blockAt(doc *gen.DocumentPayload, x, y float32) string {
	best, bestArea := "", float32(2)
	for _, b := range doc.Blocks {
		bx := b.Box
		if x < bx.X-pointerMargin || x > bx.X+bx.W+pointerMargin || y < bx.Y-pointerMargin || y > bx.Y+bx.H+pointerMargin {
			continue
		}
		if area := bx.W * bx.H; area < bestArea {
			best, bestArea = b.Id, area
		}
	}
	return best
}

func (s *Session) onUtterance(ctx context.Context, id string, u *gen.UtterancePayload, send func(any)) {
	if !u.IsFinal || strings.TrimSpace(u.Text) == "" {
		return
	}
	s.mu.Lock()
	doc, pointed := s.doc, s.lastPointed
	s.mu.Unlock()

	lang := speechLang(deref(u.Lang))
	if doc == nil {
		send(s.speak(id, localText(lang, "noDocument"), nil, lang))
		return
	}
	if u.Lang == nil {
		lang = speechLang(deref(doc.Lang))
	}
	req := llm.Request{
		System:    systemPrompt,
		Messages:  []llm.Message{{Role: "user", Text: questionPrompt(doc, pointed, u.Text)}},
		MaxTokens: s.cfg.MaxTokens,
		JSON:      true,
	}
	s.ask(ctx, id, doc, req, lang, send)
}

// ask runs a model call in the background so pointer messages keep flowing.
// A newer call cancels the previous one.
func (s *Session) ask(ctx context.Context, replyTo string, doc *gen.DocumentPayload, req llm.Request, lang string, send func(any)) {
	jobCtx, cancel := context.WithTimeout(ctx, s.cfg.ModelTimeout)
	s.mu.Lock()
	if s.cancelJob != nil {
		s.cancelJob()
	}
	s.cancelJob = cancel
	s.mu.Unlock()

	go func() {
		defer cancel()
		doubt := func(r llm.Response) bool { return s.cfg.Doubt(doc, r) }
		r, escalated, err := s.model.CompleteWithEscalation(jobCtx, req, doubt)
		if jobCtx.Err() == context.Canceled {
			return // superseded by a newer request or the connection closed
		}
		if err != nil {
			log.Printf("session: model: %v", err)
			send(s.speak(replyTo, localText(lang, "modelError"), nil, lang))
			send(s.stats())
			return
		}
		a, _, ok := parseAnswer(r.Text, doc)
		if !ok {
			a = answer{Speech: strings.TrimSpace(r.Text)}
		}
		log.Printf("session: %s answered (escalated=%v, %d ms, %.6f USD)", r.Model, escalated, r.LatencyMs, r.CostUSD)
		send(s.speak(replyTo, a.Speech, a.Highlight, lang))
		send(s.stats())
	}()
}

func (s *Session) speak(replyTo, text string, highlight []string, lang string) gen.SpeakMessage {
	if highlight == nil {
		highlight = []string{}
	}
	ts := time.Now().UnixMilli()
	m := gen.SpeakMessage{
		Type:    "speak",
		Id:      fmt.Sprintf("spk-%d-%d", ts, s.seq.Add(1)),
		Ts:      ts,
		Payload: gen.SpeakPayload{Text: text, HighlightBlockIds: highlight, Lang: lang},
	}
	if replyTo != "" {
		m.Payload.ReplyTo = &replyTo
	}
	return m
}

func (s *Session) stats() gen.StatsMessage {
	st := s.model.Stats()
	ts := time.Now().UnixMilli()
	return gen.StatsMessage{
		Type: "stats",
		Id:   fmt.Sprintf("sts-%d-%d", ts, s.seq.Add(1)),
		Ts:   ts,
		Payload: gen.StatsPayload{
			Cheap:        tierStats(st.Cheap),
			Expensive:    tierStats(st.Expensive),
			TotalCostUsd: st.TotalCostUSD,
		},
	}
}

func tierStats(t llm.TierStats) gen.TierStats {
	return gen.TierStats{
		Calls: t.Calls, CacheHits: t.CacheHits, Errors: t.Errors, CostUsd: t.CostUSD,
		AvgLatencyMs: t.AvgLatencyMs, LastLatencyMs: t.LastLatencyMs,
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
