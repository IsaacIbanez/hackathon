package session

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/IsaacIbanez/hackathon/api"
	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/llm"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

// fakeModel answers with cheap and, if doubt says so, expensive. It records the prompts.
type fakeModel struct {
	mu        sync.Mutex
	cheap     string
	expensive string
	err       error
	delay     time.Duration
	prompts   []string
	escalated int
}

func (f *fakeModel) CompleteWithEscalation(ctx context.Context, req llm.Request, doubt func(llm.Response) bool) (llm.Response, bool, error) {
	f.mu.Lock()
	f.prompts = append(f.prompts, req.Messages[0].Text)
	f.mu.Unlock()
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return llm.Response{}, false, ctx.Err()
		}
	}
	if f.err != nil {
		return llm.Response{}, false, f.err
	}
	r := llm.Response{Text: f.cheap, Tier: llm.Cheap}
	if doubt(r) {
		f.mu.Lock()
		f.escalated++
		f.mu.Unlock()
		return llm.Response{Text: f.expensive, Tier: llm.Expensive}, true, nil
	}
	return r, false, nil
}

func (f *fakeModel) Stats() llm.Stats {
	return llm.Stats{Cheap: llm.TierStats{Calls: 1, CostUSD: 0.001}, TotalCostUSD: 0.001}
}

func (f *fakeModel) promptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.prompts)
}

// collector gathers what the session sends.
type collector struct{ ch chan any }

func newCollector() *collector  { return &collector{ch: make(chan any, 32)} }
func (c *collector) send(v any) { c.ch <- v }
func (c *collector) next(t *testing.T) any {
	t.Helper()
	select {
	case v := <-c.ch:
		return v
	case <-time.After(2 * time.Second):
		t.Fatal("nothing was sent")
		return nil
	}
}
func (c *collector) none(t *testing.T) {
	t.Helper()
	select {
	case v := <-c.ch:
		t.Fatalf("unexpected message: %+v", v)
	case <-time.After(100 * time.Millisecond):
	}
}

func envelope(t *testing.T, typ, id string, payload any) gen.Envelope {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return gen.Envelope{Type: gen.MessageType(typ), Id: id, Ts: 1, Payload: data}
}

func fixtureDocument(t *testing.T) gen.DocumentPayload {
	t.Helper()
	data, _ := api.Fixtures.ReadFile("fixtures/document.json")
	var m gen.DocumentMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	m.Payload.Quality.Score = 0.9
	return m.Payload
}

func strPtr(s string) *string { return &s }

const goodAnswer = `{"speech": "Es una declaración de siniestro. Rellena tu nombre y la fecha.", "highlight": ["b2", "b3"]}`

func TestDocumentIsExplainedWithSpeakAndStats(t *testing.T) {
	m := &fakeModel{cheap: "```json\n" + goodAnswer + "\n```"}
	s := New(m, DefaultConfig())
	c := newCollector()

	s.Handle(context.Background(), envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)

	sp, ok := c.next(t).(gen.SpeakMessage)
	if !ok || !strings.Contains(sp.Payload.Text, "declaración") || *sp.Payload.ReplyTo != "doc-1" || sp.Payload.Lang != "es-ES" {
		t.Fatalf("speak: %+v", sp)
	}
	if strings.Join(sp.Payload.HighlightBlockIds, ",") != "b2,b3" {
		t.Fatalf("highlight: %v", sp.Payload.HighlightBlockIds)
	}
	st, ok := c.next(t).(gen.StatsMessage)
	if !ok || st.Payload.TotalCostUsd != 0.001 {
		t.Fatalf("stats: %+v", st)
	}
	if !strings.Contains(m.prompts[0], "[b2]") || m.escalated != 0 {
		t.Fatalf("prompt=%q escalated=%d", m.prompts[0], m.escalated)
	}
}

func TestBadFramingIsAnsweredLocally(t *testing.T) {
	m := &fakeModel{cheap: goodAnswer}
	s := New(m, DefaultConfig())
	c := newCollector()
	doc := fixtureDocument(t)
	doc.Quality = gen.FrameQuality{Score: 0.2, Issues: []gen.FrameIssue{"blurry"}}

	s.Handle(context.Background(), envelope(t, "document", "doc-1", doc), c.send)

	sp := c.next(t).(gen.SpeakMessage)
	if !strings.Contains(sp.Payload.Text, "borrosa") || m.promptCount() != 0 {
		t.Fatalf("speak=%q model calls=%d", sp.Payload.Text, m.promptCount())
	}
	c.none(t)
}

func TestPointerReadsBlockOnceWithoutModel(t *testing.T) {
	m := &fakeModel{cheap: goodAnswer}
	s := New(m, DefaultConfig())
	c := newCollector()
	ctx := context.Background()
	s.Handle(ctx, envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	c.next(t) // speak
	c.next(t) // stats

	ptr := gen.PointerPayload{X: 0.3, Y: 0.2, BlockId: strPtr("b2")}
	s.Handle(ctx, envelope(t, "pointer", "p-1", ptr), c.send)
	sp := c.next(t).(gen.SpeakMessage)
	if !strings.HasPrefix(sp.Payload.Text, "Nombre y apellidos") || sp.Payload.HighlightBlockIds[0] != "b2" {
		t.Fatalf("pointer speak: %+v", sp.Payload)
	}
	s.Handle(ctx, envelope(t, "pointer", "p-2", ptr), c.send) // same block: silent
	c.none(t)
	if m.promptCount() != 1 {
		t.Fatalf("pointer must not call the model, calls=%d", m.promptCount())
	}
}

func TestUtteranceAsksAboutTheDocument(t *testing.T) {
	m := &fakeModel{cheap: `{"speech": "Pon tu nombre completo.", "highlight": ["b2"]}`}
	s := New(m, DefaultConfig())
	c := newCollector()
	ctx := context.Background()

	s.Handle(ctx, envelope(t, "utterance", "u-0", gen.UtterancePayload{Text: "¿Qué pongo?", IsFinal: true}), c.send)
	if sp := c.next(t).(gen.SpeakMessage); !strings.Contains(sp.Payload.Text, "documento") {
		t.Fatalf("without a document it must ask for one: %q", sp.Payload.Text)
	}

	s.Handle(ctx, envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	c.next(t)
	c.next(t)
	s.Handle(ctx, envelope(t, "pointer", "p-1", gen.PointerPayload{BlockId: strPtr("b2")}), c.send)
	c.next(t)

	s.Handle(ctx, envelope(t, "utterance", "u-1", gen.UtterancePayload{Text: "¿Qué pon", IsFinal: false}), c.send)
	c.none(t) // partial results are ignored

	s.Handle(ctx, envelope(t, "utterance", "u-2", gen.UtterancePayload{Text: "¿Qué pongo aquí?", IsFinal: true}), c.send)
	sp := c.next(t).(gen.SpeakMessage)
	if sp.Payload.Text != "Pon tu nombre completo." || *sp.Payload.ReplyTo != "u-2" {
		t.Fatalf("speak: %+v", sp.Payload)
	}
	last := m.prompts[len(m.prompts)-1]
	if !strings.Contains(last, "pointing at block [b2]") || !strings.Contains(last, "¿Qué pongo aquí?") {
		t.Fatalf("question prompt: %q", last)
	}
}

func TestBadCheapAnswerEscalates(t *testing.T) {
	m := &fakeModel{
		cheap:     `{"speech": "Rellena el campo.", "highlight": ["b99"]}`, // block that does not exist
		expensive: goodAnswer,
	}
	s := New(m, DefaultConfig())
	c := newCollector()
	s.Handle(context.Background(), envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	sp := c.next(t).(gen.SpeakMessage)
	if m.escalated != 1 || !strings.Contains(sp.Payload.Text, "declaración") {
		t.Fatalf("escalated=%d speak=%q", m.escalated, sp.Payload.Text)
	}
}

func TestModelErrorGivesLocalMessage(t *testing.T) {
	m := &fakeModel{err: context.DeadlineExceeded}
	s := New(m, DefaultConfig())
	c := newCollector()
	s.Handle(context.Background(), envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	if sp := c.next(t).(gen.SpeakMessage); !strings.Contains(sp.Payload.Text, "no puedo") {
		t.Fatalf("speak: %q", sp.Payload.Text)
	}
}

func TestNewerDocumentCancelsSlowAnswer(t *testing.T) {
	m := &fakeModel{cheap: goodAnswer, delay: 300 * time.Millisecond}
	s := New(m, DefaultConfig())
	c := newCollector()
	ctx := context.Background()
	s.Handle(ctx, envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	s.Handle(ctx, envelope(t, "document", "doc-2", fixtureDocument(t)), c.send)

	sp := c.next(t).(gen.SpeakMessage)
	if *sp.Payload.ReplyTo != "doc-2" {
		t.Fatalf("only the newest document must be answered, got reply to %s", *sp.Payload.ReplyTo)
	}
	c.next(t) // stats
	c.none(t)
}

// End to end through the real API: the scanner POSTs a document, the UI (WebSocket) hears it.
func TestScannerPostReachesTheUI(t *testing.T) {
	h, hub := NewMux(&fakeModel{cheap: goodAnswer}, DefaultConfig())
	srv := httptest.NewServer(h)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ui1, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ui1.CloseNow()
	ui2, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ui2.CloseNow()
	waitClients(t, hub, 2)

	data, _ := api.Fixtures.ReadFile("fixtures/document.json")
	resp, err := http.Post(srv.URL+"/message", "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST /message: %d", resp.StatusCode)
	}

	for i, ui := range []*websocket.Conn{ui1, ui2} {
		var sp gen.SpeakMessage
		if err := wsjson.Read(ctx, ui, &sp); err != nil || sp.Type != "speak" || *sp.Payload.ReplyTo != "doc-0001" {
			t.Fatalf("client %d speak: %+v %v", i, sp, err)
		}
		var st gen.StatsMessage
		if err := wsjson.Read(ctx, ui, &st); err != nil || st.Type != "stats" {
			t.Fatalf("client %d stats: %+v %v", i, st, err)
		}
	}

	// The document is shared: a pointer from the UI is answered with the scanner's document.
	ptr, _ := json.Marshal(gen.PointerMessage{Type: "pointer", Id: "p-1", Ts: 1, Payload: gen.PointerPayload{X: 0.3, Y: 0.27}})
	if err := ui1.Write(ctx, websocket.MessageText, ptr); err != nil {
		t.Fatal(err)
	}
	var sp gen.SpeakMessage
	if err := wsjson.Read(ctx, ui2, &sp); err != nil || sp.Payload.HighlightBlockIds[0] != "b3" {
		t.Fatalf("pointer speak on the other client: %+v %v", sp, err)
	}
}

func TestPostRejectsNonEnvelopes(t *testing.T) {
	h, _ := NewMux(&fakeModel{cheap: goodAnswer}, DefaultConfig())
	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, err := http.Post(srv.URL+"/message", "application/json", strings.NewReader(`{"hello":1}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

// waitClients waits until the hub has registered n connections (the server registers a
// client right after the handshake, which may be just after Dial returns).
func waitClients(t *testing.T, hub *ws.Hub, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for hub.Clients() < n {
		if time.Now().After(deadline) {
			t.Fatalf("only %d of %d clients registered", hub.Clients(), n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPointerWithoutBlockIdIsHitTested(t *testing.T) {
	m := &fakeModel{cheap: goodAnswer}
	s := New(m, DefaultConfig())
	c := newCollector()
	ctx := context.Background()
	s.Handle(ctx, envelope(t, "document", "doc-1", fixtureDocument(t)), c.send)
	c.next(t)
	c.next(t)

	// b3 "Fecha del siniestro" is at x 0.08–0.58, y 0.25–0.29.
	s.Handle(ctx, envelope(t, "pointer", "p-1", gen.PointerPayload{X: 0.3, Y: 0.27}), c.send)
	sp := c.next(t).(gen.SpeakMessage)
	if sp.Payload.HighlightBlockIds[0] != "b3" {
		t.Fatalf("expected b3, got %v", sp.Payload.HighlightBlockIds)
	}
	// Moving inside the same block, or to empty space, says nothing.
	s.Handle(ctx, envelope(t, "pointer", "p-2", gen.PointerPayload{X: 0.4, Y: 0.26}), c.send)
	s.Handle(ctx, envelope(t, "pointer", "p-3", gen.PointerPayload{X: 0.9, Y: 0.6}), c.send)
	c.none(t)
}

func TestBlockAtPrefersSmallestBox(t *testing.T) {
	doc := &gen.DocumentPayload{Blocks: []gen.TextBlock{
		{Id: "section", Box: gen.Box{X: 0, Y: 0, W: 1, H: 0.5}},
		{Id: "field", Box: gen.Box{X: 0.2, Y: 0.2, W: 0.3, H: 0.05}},
	}}
	if got := blockAt(doc, 0.3, 0.22); got != "field" {
		t.Fatalf("got %q", got)
	}
	if got := blockAt(doc, 0.9, 0.4); got != "section" {
		t.Fatalf("got %q", got)
	}
	if got := blockAt(doc, 0.5, 0.9); got != "" {
		t.Fatalf("got %q", got)
	}
}
