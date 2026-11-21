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
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/llm"
	"github.com/IsaacIbanez/hackathon/backend/scanner"
)

// Model is what the session needs from backend/llm (an interface so tests can fake it).
type Model interface {
	Complete(ctx context.Context, req llm.Request) (llm.Response, error)
	CompleteWithEscalation(ctx context.Context, req llm.Request, doubt func(llm.Response) bool) (llm.Response, bool, error)
	Stats() llm.Stats
}

// DefaultTranscribeModels: measured on 2026-11-21 (docs/VOZ.md). Gemini 2.5 Flash Lite is
// correct in ~2.3 s for $0.00006; the free Nemotron omni is correct but slow (~7 s): backup.
const DefaultTranscribeModels = "google/gemini-2.5-flash-lite,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"

// Scanner reads a document from a camera photo (backend/scanner talks to role B2's service).
type Scanner interface {
	Scan(ctx context.Context, photo []byte, contentType string) (gen.DocumentPayload, error)
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
	// Scanner reads photos sent to POST /scan. Nil = the reading service at SCANNER_URL.
	Scanner Scanner
	// TranscribeModels for POST /transcribe (comma-separated, tried in order).
	TranscribeModels string
}

// DefaultConfig returns the configuration used by the app.
func DefaultConfig() Config {
	models := os.Getenv("LLM_TRANSCRIBE_MODELS")
	if models == "" {
		models = DefaultTranscribeModels
	}
	return Config{MinQuality: 0.5, Doubt: DefaultDoubt, ModelTimeout: 45 * time.Second, MaxTokens: 1500, TranscribeModels: models}
}

// Session holds the conversation state (last document, pointed block). It implements
// ws.Session and is goroutine-safe: the app shares one Session among all its clients.
type Session struct {
	model Model
	cfg   Config

	mu          sync.Mutex
	doc         *gen.DocumentPayload // last usable document
	hovered     string               // block under the pointer right now ("" = none)
	lastPointed string               // last block the user pointed at (context for questions)
	cancelJob   context.CancelFunc   // model call in flight, if any
	seq         atomic.Int64
}

// New creates a session.
func New(model Model, cfg Config) *Session {
	return &Session{model: model, cfg: cfg}
}

// ScanPhoto reads a document from a camera photo (the "lee el documento" command): it says
// that it is reading, asks the Scanner and then handles the result like any other document
// (echo, explanation, highlights). Problems are spoken, never silent.
func (s *Session) ScanPhoto(ctx context.Context, photo []byte, contentType string, send func(any)) {
	s.mu.Lock()
	lang := "es-ES"
	if s.doc != nil {
		lang = speechLang(deref(s.doc.Lang))
	}
	s.mu.Unlock()
	send(s.speak("", localText(lang, "scanning"), nil, lang))

	doc, err := s.cfg.Scanner.Scan(ctx, photo, contentType)
	if err != nil {
		key := "scanError"
		switch {
		case errors.Is(err, scanner.ErrNoPage):
			key = "noPage"
		case errors.Is(err, scanner.ErrUnavailable):
			key = "scannerDown"
		}
		log.Printf("session: scan: %v", err)
		if ctx.Err() == nil {
			send(s.speak("", localText(lang, key), nil, lang))
		}
		return
	}
	s.onDocument(ctx, fmt.Sprintf("scan-%d", time.Now().UnixMilli()), &doc, send)
}

// Transcribe turns a recording (WAV) into text with an audio-capable model. It is the cloud
// backup of the on-device recognizer (role C), used only when that one fails. The cost is
// counted under the cheap tier and the updated meter is sent with send.
func (s *Session) Transcribe(ctx context.Context, wav []byte, lang string, send func(any)) (llm.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, s.cfg.ModelTimeout)
	defer cancel()
	r, err := s.model.Complete(ctx, llm.Request{
		Tier:      llm.Cheap,
		Models:    s.cfg.TranscribeModels,
		MaxTokens: 800, // the free backup reasons before answering
		Messages: []llm.Message{{
			Role:  "user",
			Text:  transcribePrompt(lang),
			Audio: &llm.Audio{Data: wav, Format: "wav"},
		}},
	})
	send(s.stats())
	if err != nil {
		return r, err
	}
	r.Text = cleanTranscript(r.Text)
	return r, nil
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
	s.hovered, s.lastPointed = "", ""
	s.mu.Unlock()
	// Echo the accepted document so every UI can show and highlight it, even when the
	// scanner sent it. Documents with bad framing are not echoed: the UI keeps the last good one.
	send(gen.DocumentMessage{Type: "document", Id: id, Ts: time.Now().UnixMilli(), Payload: *doc})

	req := llm.Request{
		System:    systemPrompt,
		Messages:  []llm.Message{{Role: "user", Text: explainPrompt(doc)}},
		MaxTokens: s.cfg.MaxTokens,
		JSON:      true,
	}
	s.ask(ctx, id, doc, req, lang, send)
}

// onPointer reads aloud the block under the pointer when the pointer enters it. Leaving a
// block (pointing at empty space) and coming back reads it again; staying inside says nothing.
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
		if blockID != s.hovered {
			s.hovered = blockID
			for i := range doc.Blocks {
				if blockID != "" && doc.Blocks[i].Id == blockID {
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

// PointerReach is how far (in document units) a fingertip can be from a block and still
// point at it. Text lines are thin and a fingertip is not precise: without some reach,
// pointing at a form field is frustrating. Keep it in sync with web/src/app/pointing.ts.
const PointerReach = 0.05

// blockAt returns the id of the block under (x, y), or "" if none. A point inside several
// boxes picks the smallest (the most specific: a field inside a section). A point inside
// none picks the nearest box within PointerReach.
func blockAt(doc *gen.DocumentPayload, x, y float32) string {
	inside, insideArea := "", float32(2)
	near, nearDist := "", float32(PointerReach)
	for _, b := range doc.Blocks {
		bx := b.Box
		dx := max(bx.X-x, 0, x-(bx.X+bx.W))
		dy := max(bx.Y-y, 0, y-(bx.Y+bx.H))
		if dx == 0 && dy == 0 {
			if area := bx.W * bx.H; area < insideArea {
				inside, insideArea = b.Id, area
			}
			continue
		}
		if d := float32(math.Hypot(float64(dx), float64(dy))); d <= nearDist {
			near, nearDist = b.Id, d
		}
	}
	if inside != "" {
		return inside
	}
	return near
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
