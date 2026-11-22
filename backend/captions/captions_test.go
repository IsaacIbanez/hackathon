package captions

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/coder/websocket"
)

// --- a fake Together AI ---

// cue: when the fake has received `at` seconds of audio it sends a delta or a completed event.
type cue struct {
	at    float64
	final bool
	text  string
}

type fakeTogether struct {
	t          *testing.T
	cues       []cue
	dropFirst  bool                             // close the first realtime connection after a few chunks
	turns      func(durationSec float64) []turn // diarization answer for a WAV of that length
	connects   atomic.Int32
	diarizeReq atomic.Int32
	mu         sync.Mutex
	query      string
	lm         func(polishInput) polishResult // the fake language model (default spanishLM)
	polished   []polishInput
}

// spanishLM says every sentence is Spanish and "translates" it by prefixing "EN: ".
func spanishLM(in polishInput) polishResult {
	r := polishResult{Lang: "es", Text: in.Sentence}
	if in.Target != "none" {
		r.Translation = "EN: " + in.Sentence
	}
	return r
}

func (f *fakeTogether) server() *httptest.Server {
	mux := http.NewServeMux()
	auth := func(w http.ResponseWriter, r *http.Request) bool {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return false
		}
		return true
	}
	mux.HandleFunc("/v1/realtime", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		n := f.connects.Add(1)
		f.mu.Lock()
		f.query = r.URL.RawQuery
		f.mu.Unlock()
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"session.created"}`))
		var got int
		next := 0
		chunks := 0
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			var msg struct{ Type, Audio string }
			_ = json.Unmarshal(data, &msg)
			switch msg.Type {
			case "input_audio_buffer.append":
				pcm, _ := base64.StdEncoding.DecodeString(msg.Audio)
				got += len(pcm)
				chunks++
				if f.dropFirst && n == 1 && chunks == 3 {
					_ = c.Close(websocket.StatusGoingAway, "bye")
					return
				}
				for next < len(f.cues) && secondsOf(got) >= f.cues[next].at {
					cu := f.cues[next]
					next++
					ev := map[string]string{"type": "conversation.item.input_audio_transcription.delta", "delta": cu.text}
					if cu.final {
						ev = map[string]string{"type": "conversation.item.input_audio_transcription.completed", "transcript": cu.text}
					}
					b, _ := json.Marshal(ev)
					_ = c.Write(ctx, websocket.MessageText, b)
				}
			case "input_audio_buffer.commit":
				_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"conversation.item.input_audio_transcription.completed","transcript":""}`))
			}
		}
	})
	mux.HandleFunc("/v1/audio/transcriptions", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		f.diarizeReq.Add(1)
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			f.t.Errorf("diarize: %v", err)
			return
		}
		if r.FormValue("diarize") != "true" || r.FormValue("model") != DefaultDiarizeModel {
			f.t.Errorf("diarize form: diarize=%q model=%q", r.FormValue("diarize"), r.FormValue("model"))
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			f.t.Errorf("diarize file: %v", err)
			return
		}
		head := make([]byte, 44)
		_, _ = file.Read(head)
		dur := secondsOf(int(binary.LittleEndian.Uint32(head[40:])))
		var segs []map[string]any
		for _, tr := range f.turns(dur) {
			segs = append(segs, map[string]any{"speaker_id": tr.Speaker, "start": tr.Start, "end": tr.End})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"text": "", "speaker_segments": segs})
	})
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		var req struct {
			Messages  []struct{ Role, Content string }
			Reasoning *struct{ Enabled bool }
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Reasoning == nil || req.Reasoning.Enabled {
			f.t.Errorf("translation must disable reasoning (Qwen3.5 spends every token thinking)")
		}
		var in polishInput
		if err := json.Unmarshal([]byte(req.Messages[len(req.Messages)-1].Content), &in); err != nil {
			f.t.Errorf("language model input is not JSON: %v", err)
		}
		f.mu.Lock()
		f.polished = append(f.polished, in)
		f.mu.Unlock()
		lm := f.lm
		if lm == nil {
			lm = spanishLM
		}
		answer, _ := json.Marshal(lm(in))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": "<think>hm</think>" + string(answer)}}},
			"usage":   map[string]int{"prompt_tokens": 50, "completion_tokens": 10},
		})
	})
	return httptest.NewServer(mux)
}

func (f *fakeTogether) config(srv *httptest.Server, dir string) Config {
	return Config{
		APIKey:         "test-key",
		RealtimeURL:    "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/realtime",
		APIURL:         srv.URL + "/v1",
		Dir:            dir,
		DiarizeEvery:   2 * time.Second,
		DiarizeOverlap: time.Second,
		RetryDelays:    []time.Duration{10 * time.Millisecond, 10 * time.Millisecond, 10 * time.Millisecond},
		Now:            func() time.Time { return time.Date(2026, 11, 21, 23, 30, 0, 0, time.UTC) },
	}
}

// --- audio and client helpers ---

// speech returns `sec` seconds of a loud tone (voiced) or of silence.
func speech(sec float64, voiced bool) []byte {
	n := int(sec * SampleRate)
	out := make([]byte, 2*n)
	for i := range n {
		v := 0.0
		if voiced {
			v = 8000 * math.Sin(2*math.Pi*220*float64(i)/SampleRate)
		}
		binary.LittleEndian.PutUint16(out[2*i:], uint16(int16(v)))
	}
	return out
}

type client struct {
	t      *testing.T
	c      *websocket.Conn
	events chan gen.CaptionsEvent
}

func dial(t *testing.T, h http.Handler, query string) *client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/captions?"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	cl := &client{t: t, c: c, events: make(chan gen.CaptionsEvent, 256)}
	go func() {
		defer close(cl.events)
		for {
			_, data, err := c.Read(context.Background())
			if err != nil {
				return
			}
			var ev gen.CaptionsEvent
			if json.Unmarshal(data, &ev) == nil {
				cl.events <- ev
			}
		}
	}()
	return cl
}

// send streams pcm in 100 ms chunks. It stops quietly when the server has closed the session
// (some tests send from a goroutine while the server ends it).
func (cl *client) send(pcm []byte) {
	for i := 0; i < len(pcm); i += 3200 {
		if cl.c.Write(context.Background(), websocket.MessageBinary, pcm[i:min(i+3200, len(pcm))]) != nil {
			return
		}
		time.Sleep(time.Millisecond)
	}
}

func (cl *client) text(s string) {
	if err := cl.c.Write(context.Background(), websocket.MessageText, []byte(s)); err != nil {
		cl.t.Fatal(err)
	}
}

// until collects events until one matches stop (or the connection closes / times out).
func (cl *client) until(stop func(gen.CaptionsEvent) bool) []gen.CaptionsEvent {
	cl.t.Helper()
	var got []gen.CaptionsEvent
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev, ok := <-cl.events:
			if !ok {
				return got
			}
			got = append(got, ev)
			if stop != nil && stop(ev) {
				return got
			}
		case <-timeout:
			cl.t.Fatalf("timed out; got %s", describe(got))
			return got
		}
	}
}

func describe(evs []gen.CaptionsEvent) string {
	var parts []string
	for _, e := range evs {
		b, _ := json.Marshal(e)
		parts = append(parts, string(b))
	}
	return strings.Join(parts, "\n")
}

func val[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// --- tests ---

func TestCaptionsFlow(t *testing.T) {
	f := &fakeTogether{t: t,
		cues: []cue{
			{at: 0.5, text: "Primera"},
			{at: 1.5, final: true, text: "Primera frase."},
			{at: 2.5, text: "Segunda"},
			{at: 3.5, final: true, text: "Segunda frase."},
		},
		// Two speakers taking turns: the first second of the session, then the third.
		turns: func(dur float64) []turn {
			if dur > 3 {
				return []turn{{span{0, 1.2}, "SPEAKER_00"}, {span{2, 3.2}, "SPEAKER_01"}}
			}
			return []turn{{span{0, 1.2}, "SPEAKER_00"}}
		},
	}
	srv := f.server()
	defer srv.Close()
	dir := t.TempDir()
	cl := dial(t, New(f.config(srv, dir), nil), "lang=es&target=en")

	cl.send(speech(1, true))
	cl.send(speech(1, false))
	cl.send(speech(1, true))
	cl.send(speech(1, false))
	evs := cl.until(func(e gen.CaptionsEvent) bool { return e.Type == "translation" && val(e.Id) == "s2" })
	cl.text(`{"type":"stop"}`)
	evs = append(evs, cl.until(nil)...)

	finals := map[string]gen.CaptionsEvent{}
	speakers := map[string]string{}
	translations := map[string]string{}
	var partials []string
	var saved string
	sawReady, sawCost := false, false
	for _, e := range evs {
		switch e.Type {
		case "ready":
			sawReady = val(e.Model) == DefaultASRModel && val(e.Lang) == "es" && val(e.Target) == "en"
		case "partial":
			partials = append(partials, val(e.Text))
		case "final":
			finals[val(e.Id)] = e
		case "speaker":
			speakers[val(e.Id)] = val(e.Speaker)
		case "translation":
			translations[val(e.Id)] = val(e.Text)
		case "cost":
			sawCost = val(e.CostUsd) > 0 && val(e.LimitUsd) == DefaultLimitUSD
		case "saved":
			saved = val(e.Path)
		case "error":
			t.Errorf("unexpected error event: %s", val(e.Message))
		}
	}
	if !sawReady || !sawCost {
		t.Errorf("ready=%v cost=%v\n%s", sawReady, sawCost, describe(evs))
	}
	if strings.Join(partials, "|") != "Primera|Segunda" {
		t.Errorf("partials = %q", partials)
	}
	if val(finals["s1"].Text) != "Primera frase." || val(finals["s2"].Text) != "Segunda frase." {
		t.Fatalf("finals = %s", describe(evs))
	}
	// The voice detector places each sentence on its tone: 0-1 s and 2-3 s.
	if s := val(finals["s1"].Start); s > 0.1 {
		t.Errorf("s1 start = %v, want ~0", s)
	}
	if s := val(finals["s2"].Start); math.Abs(s-2) > 0.1 {
		t.Errorf("s2 start = %v, want ~2", s)
	}
	if translations["s1"] != "EN: Primera frase." || translations["s2"] != "EN: Segunda frase." {
		t.Errorf("translations = %v", translations)
	}
	if speakers["s1"] != "Speaker 1" || speakers["s2"] != "Speaker 2" {
		t.Errorf("speakers = %v", speakers)
	}
	if f.diarizeReq.Load() < 2 {
		t.Errorf("diarization requests = %d, want live ones and the final pass", f.diarizeReq.Load())
	}
	if !strings.Contains(f.query, "language=es") || !strings.Contains(f.query, "input_audio_format=pcm_s16le_16000") {
		t.Errorf("realtime query = %q", f.query)
	}
	data, err := os.ReadFile(saved)
	if err != nil {
		t.Fatalf("saved transcript: %v", err)
	}
	want := "Live captions — 2026-11-21 23:30 — spoken: es — translated to: en\n" +
		"== Original ==\n" +
		"[00:00:00] Speaker 1 (es): Primera frase.\n" +
		"[00:00:02] Speaker 2 (es): Segunda frase.\n" +
		"\n== Translation (en) ==\n" +
		"[00:00:00] Speaker 1: EN: Primera frase.\n" +
		"[00:00:02] Speaker 2: EN: Segunda frase.\n"
	if string(data) != want {
		t.Errorf("transcript:\n%s\nwant:\n%s", data, want)
	}
	if !strings.HasPrefix(saved, dir) || !strings.HasSuffix(saved, "captions-2026-11-21-2330.txt") {
		t.Errorf("saved at %q", saved)
	}
}

func TestNoKey(t *testing.T) {
	cl := dial(t, New(Config{Dir: t.TempDir()}, nil), "")
	evs := cl.until(nil)
	if len(evs) != 1 || evs[0].Type != "error" || val(evs[0].Code) != gen.CaptionsEventCodeNoKey || val(evs[0].Retryable) {
		t.Fatalf("events = %s", describe(evs))
	}
}

func TestRefusedKeyIsNotRetried(t *testing.T) {
	f := &fakeTogether{t: t, turns: func(float64) []turn { return nil }}
	srv := f.server()
	defer srv.Close()
	cfg := f.config(srv, t.TempDir())
	cfg.APIKey = "wrong"
	cl := dial(t, New(cfg, nil), "")
	evs := cl.until(func(e gen.CaptionsEvent) bool { return e.Type == "error" })
	last := evs[len(evs)-1]
	if val(last.Code) != gen.CaptionsEventCodeUpstream || val(last.Retryable) || !strings.Contains(val(last.Message), "401") {
		t.Fatalf("events = %s", describe(evs))
	}
	cl.text(`{"type":"stop"}`)
	cl.until(nil)
}

func TestReconnectsAfterADrop(t *testing.T) {
	f := &fakeTogether{t: t, dropFirst: true, turns: func(float64) []turn { return nil },
		cues: []cue{{at: 0.3, final: true, text: "Hola."}}}
	srv := f.server()
	defer srv.Close()
	cl := dial(t, New(f.config(srv, t.TempDir()), nil), "")
	go cl.send(speech(3, true))
	evs := cl.until(func(e gen.CaptionsEvent) bool { return e.Type == "final" })
	var retry, ready int
	for _, e := range evs {
		if e.Type == "error" && val(e.Code) == gen.CaptionsEventCodeUpstream && val(e.Retryable) {
			retry++
		}
		if e.Type == "ready" {
			ready++
		}
	}
	if retry != 1 || ready != 2 || f.connects.Load() != 2 {
		t.Fatalf("retry=%d ready=%d connects=%d\n%s", retry, ready, f.connects.Load(), describe(evs))
	}
	cl.text(`{"type":"stop"}`)
	cl.until(nil)
}

func TestGivesUpAfterTheRetries(t *testing.T) {
	cfg := Config{APIKey: "k", RealtimeURL: "ws://127.0.0.1:1/v1/realtime", Dir: t.TempDir(),
		RetryDelays: []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}}
	cl := dial(t, New(cfg, nil), "")
	evs := cl.until(func(e gen.CaptionsEvent) bool { return e.Type == "error" && !val(e.Retryable) })
	retries := 0
	for _, e := range evs {
		if val(e.Retryable) {
			retries++
		}
	}
	if retries != 3 {
		t.Fatalf("retries = %d\n%s", retries, describe(evs))
	}
	cl.text(`{"type":"stop"}`)
	cl.until(nil)
}

func TestCostLimitStopsTheSession(t *testing.T) {
	f := &fakeTogether{t: t, turns: func(float64) []turn { return nil },
		cues: []cue{{at: 0.5, final: true, text: "Una frase."}}}
	srv := f.server()
	defer srv.Close()
	cfg := f.config(srv, t.TempDir())
	cfg.LimitUSD = 0.0001 // ~1.3 s of audio
	cl := dial(t, New(cfg, nil), "")
	go cl.send(speech(4, true))
	evs := cl.until(nil) // the server ends the session by itself
	var limit, saved bool
	for _, e := range evs {
		limit = limit || (e.Type == "error" && val(e.Code) == gen.CaptionsEventCodeLimitReached)
		saved = saved || e.Type == "saved"
	}
	if !limit || !saved {
		t.Fatalf("limit=%v saved=%v\n%s", limit, saved, describe(evs))
	}
}

func TestSpeakerMapKeepsLabelsAcrossWindows(t *testing.T) {
	var m speakerMap
	// Window 1 (0-30 s): A, B, A.
	m.add(0, 30, []turn{{span{0, 12}, "SPEAKER_00"}, {span{14, 22}, "SPEAKER_01"}, {span{23, 30}, "SPEAKER_00"}})
	// Window 2 (20-60 s): the same people, labelled the other way round by the service. Both
	// talk in the overlap (20-30 s), which is what lets the map recognise them.
	m.add(20, 60, []turn{{span{20, 22}, "SPEAKER_00"}, {span{23, 45}, "SPEAKER_01"}, {span{46, 60}, "SPEAKER_00"}})
	cases := []struct {
		s    span
		want string
	}{
		{span{1, 10}, "Speaker 1"},
		{span{15, 21}, "Speaker 2"},
		{span{32, 44}, "Speaker 1"}, // SPEAKER_01 of window 2 = the first speaker
		{span{47, 59}, "Speaker 2"},
	}
	for _, c := range cases {
		if got := m.speakerOf(c.s); got != c.want {
			t.Errorf("speakerOf(%v) = %q, want %q", c.s, got, c.want)
		}
	}
	// A voice that does not talk in the overlap is a new speaker (live labels are approximate;
	// the final pass over the whole recording fixes them).
	m.add(50, 90, []turn{{span{50, 60}, "SPEAKER_01"}, {span{61, 90}, "SPEAKER_00"}})
	if got := m.speakerOf(span{62, 89}); got != "Speaker 3" {
		t.Errorf("new voice = %q", got)
	}
	if got := m.speakerOf(span{51, 59}); got != "Speaker 2" {
		t.Errorf("overlap voice = %q", got)
	}
}

func TestSentenceSpanFollowsTheVoice(t *testing.T) {
	var v voiceDetector
	v.write(speech(0.5, false))
	v.write(speech(1, true))
	v.write(speech(1, false))
	v.write(speech(0.7, true))
	first := v.sentenceSpan(0, 2.0)
	second := v.sentenceSpan(first.End, 3.2)
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.05 }
	if !near(first.Start, 0.5) || !near(first.End, 1.5) || !near(second.Start, 2.5) || !near(second.End, 3.2) {
		t.Fatalf("first=%v second=%v", first, second)
	}
	if got := v.sentenceSpan(3.2, 4); got != (span{3.2, 4}) {
		t.Errorf("no voice: %v", got)
	}
}

func TestWAVHeader(t *testing.T) {
	w := wav(make([]byte, 3200))
	if string(w[:4]) != "RIFF" || string(w[8:12]) != "WAVE" || binary.LittleEndian.Uint32(w[24:]) != 16000 || binary.LittleEndian.Uint32(w[40:]) != 3200 {
		t.Fatalf("bad header % x", w[:44])
	}
}

func TestCleanLang(t *testing.T) {
	for in, want := range map[string]string{"es": "es", "en-US": "en-US", "": "auto", "x;drop": "auto", "auto": "auto"} {
		if got := cleanLang(in, "auto"); got != want {
			t.Errorf("cleanLang(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCleanCaptionRemovesTheServiceNoise(t *testing.T) {
	// Real finals from nvidia/nemotron-3.5-asr-streaming-0.6b (2026-11-21).
	for in, want := range map[string]string{
		" Cuando vence el plazo del seguro del coche": "Cuando vence el plazo del seguro del coche",
		" . .  El 15 de diciembre":                    "El 15 de diciembre",
		" . . . .  Abajo a la derecha":                "Abajo a la derecha",
		"  Tiene que enviar el formulario":            "Tiene que enviar el formulario",
		" . . ":                                       "",
		". ":                                          "",
		"Hola. ¿Qué tal?":                             "Hola. ¿Qué tal?",
	} {
		if got := cleanCaption(in); got != want {
			t.Errorf("cleanCaption(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStreamClockFollowsGapsInTheRecording(t *testing.T) {
	var c streamClock
	c.sending(0, 1) // recording 0-1 s = stream 0-1 s
	c.sending(1, 1) // contiguous
	c.sending(5, 1) // 3 s dropped while reconnecting: stream 2-3 s = recording 5-6 s
	c.sent += 0.5   // flush silence (not in the recording)
	for stream, want := range map[float64]float64{0.5: 0.5, 1.9: 1.9, 2.25: 5.25, 2.9: 5.9} {
		if got := c.toSession(stream); math.Abs(got-want) > 1e-9 {
			t.Errorf("toSession(%v) = %v, want %v", stream, got, want)
		}
	}
}

func TestSameWordsOnlyAllowsQuotes(t *testing.T) {
	orig := "Mañana tenemos el meeting a las 10, no te olvides del deadline."
	if !sameWords(orig, `Mañana tenemos el "meeting" a las 10, no te olvides del "deadline".`) {
		t.Error("adding quotes must be accepted")
	}
	if !sameWords("Okay, hasta luego.", "Okay, «hasta luego».") {
		t.Error("other quote marks must be accepted")
	}
	for _, bad := range []string{
		`Mañana tenemos la "reunión" a las 10, no te olvides del "deadline".`, // a word changed
		`Mañana tenemos el "meeting" a las diez, no te olvides del "deadline".`,
		`Mañana tenemos el "meeting" a las 10 no te olvides del "deadline".`, // punctuation removed
	} {
		if sameWords(orig, bad) {
			t.Errorf("must be rejected: %s", bad)
		}
	}
}

func TestUsualLanguageNeedsTwoSentences(t *testing.T) {
	mk := func(sp, lang string) *sentence { return &sentence{Speaker: sp, Lang: lang} }
	list := []*sentence{mk("Speaker 1", "es"), mk("Speaker 2", "en"), mk("Speaker 1", "es"), mk("Speaker 2", "es"), mk("Speaker 1", "en")}
	if got := usualLanguage(list, "Speaker 1", nil); got != "es" {
		t.Errorf("Speaker 1 = %q, want es (2 of 3)", got)
	}
	if got := usualLanguage(list, "Speaker 2", nil); got != "" {
		t.Errorf("Speaker 2 = %q, want unknown (1 en, 1 es)", got)
	}
	if got := usualLanguage(list, "Speaker 1", list[0]); got != "" {
		t.Errorf("skipping one leaves a tie: %q", got)
	}
}

func TestFinalPassKeepsTheLiveNumbering(t *testing.T) {
	sents := []*sentence{
		{span: span{0, 2}, Speaker: "Speaker 1"},
		{span: span{3, 5}, Speaker: "Speaker 2"},
		{span: span{6, 8}, Speaker: "Speaker 1"},
	}
	var m speakerMap
	// The final pass numbers the voices the other way round and finds a third one.
	m.add(0, 12, []turn{{span{0, 2}, "SPEAKER_00"}, {span{3, 5}, "SPEAKER_01"}, {span{6, 8}, "SPEAKER_00"}, {span{9, 11}, "SPEAKER_02"}})
	m.turns[0].Speaker, m.turns[2].Speaker = "Speaker 2", "Speaker 2"
	m.turns[1].Speaker = "Speaker 1"
	m.alignTo(sents)
	for _, c := range []struct {
		s    span
		want string
	}{{span{0, 2}, "Speaker 1"}, {span{3, 5}, "Speaker 2"}, {span{6, 8}, "Speaker 1"}, {span{9, 11}, "Speaker 3"}} {
		if got := m.speakerOf(c.s); got != c.want {
			t.Errorf("speakerOf(%v) = %q, want %q", c.s, got, c.want)
		}
	}
}

// Two languages in one meeting: the model marks barbarisms in quotes, and a short phrase is
// checked again once we know its speaker usually speaks English.
func TestBilingualMeetingWithBarbarisms(t *testing.T) {
	f := &fakeTogether{t: t,
		cues: []cue{
			{at: 1.5, final: true, text: "Mañana tenemos el meeting a las 10."},
			{at: 3.5, final: true, text: "Sure, I will send the report."},
			{at: 5.5, final: true, text: "I will check it tonight."},
			{at: 7.5, final: true, text: "Okay, hasta luego."},
		},
		// Voice A: 0-1 s. Voice B: the rest.
		turns: func(dur float64) []turn {
			ts := []turn{{span{0, 1.2}, "SPEAKER_00"}}
			for st := 2.0; st+1 <= dur; st += 2 {
				ts = append(ts, turn{span{st, st + 1.2}, "SPEAKER_01"})
			}
			return ts
		},
		lm: func(in polishInput) polishResult {
			switch {
			case strings.HasPrefix(in.Sentence, "Mañana"):
				return polishResult{Lang: "es", Text: `Mañana tenemos el "meeting" a las 10.`, Translation: "Tomorrow we have the meeting at 10."}
			case strings.HasPrefix(in.Sentence, "Okay"):
				// Without context the model hesitates; with the speaker's language it is sure.
				if in.SpeakerLang == "en" {
					return polishResult{Lang: "en", Text: `Okay, "hasta luego".`}
				}
				return polishResult{Lang: "es", Text: in.Sentence, Translation: "Okay, see you later."}
			default:
				return polishResult{Lang: "en", Text: in.Sentence}
			}
		},
	}
	srv := f.server()
	defer srv.Close()
	cfg := f.config(srv, t.TempDir())
	cfg.DiarizeEvery = 8 * time.Second // one live window covering everything
	cl := dial(t, New(cfg, nil), "lang=auto&target=en&speakers=2")
	for range 4 {
		cl.send(speech(1, true))
		cl.send(speech(1, false))
	}
	evs := cl.until(func(e gen.CaptionsEvent) bool { return e.Type == "revise" })
	cl.text(`{"type":"stop"}`)
	evs = append(evs, cl.until(nil)...)

	texts, langs, tr := map[string]string{}, map[string]string{}, map[string]string{}
	var saved string
	for _, e := range evs {
		switch e.Type {
		case "final", "revise":
			texts[val(e.Id)], langs[val(e.Id)] = val(e.Text), val(e.Lang)
		case "translation":
			tr[val(e.Id)] = val(e.Text)
		case "saved":
			saved = val(e.Path)
		}
	}
	if texts["s1"] != `Mañana tenemos el "meeting" a las 10.` || langs["s1"] != "es" || tr["s1"] != "Tomorrow we have the meeting at 10." {
		t.Errorf("s1: %q (%s) -> %q", texts["s1"], langs["s1"], tr["s1"])
	}
	// English sentences are not sent for translation to English: the text is the translation.
	if langs["s2"] != "en" || tr["s2"] != "Sure, I will send the report." {
		t.Errorf("s2: %s -> %q", langs["s2"], tr["s2"])
	}
	if texts["s4"] != `Okay, "hasta luego".` || langs["s4"] != "en" || tr["s4"] != `Okay, "hasta luego".` {
		t.Errorf("s4 after knowing the speaker: %q (%s) -> %q\n%s", texts["s4"], langs["s4"], tr["s4"], describe(evs))
	}
	if strings.Contains(f.query, "language=") {
		t.Errorf("auto must not force a language: %q", f.query)
	}
	data, _ := os.ReadFile(saved)
	if !strings.Contains(string(data), "Speaker 2 (en): Okay, \"hasta luego\".") {
		t.Errorf("transcript:\n%s", data)
	}
}

// The labels Together's diarization gave the real bilingual dialogue (Spanish voice A, English
// voice B, taking turns): it mixed the two voices. The language fixes it.
func TestRefineByLanguageFixesMixedUpVoices(t *testing.T) {
	mk := func(sp, lang, text string) *sentence { return &sentence{Speaker: sp, Lang: lang, Text: text} }
	sents := []*sentence{
		mk("Speaker 1", "es", `Mañana tenemos el "meeting" a las 10, no te olvides del "deadline".`), // A
		mk("Speaker 1", "en", "Sure, I will send you the report before the meeting."),                // B
		mk("Speaker 2", "es", "Perfecto. Gracias."),                                                  // A
		mk("Speaker 2", "es", `Puedes revisar también el "budget" del proyecto.`),                    // A
		mk("", "en", "Yes, no problem."),                                                             // B, no label
		mk("Speaker 1", "en", "I will check it tonight."),                                            // B
		mk("Speaker 1", "es", "Vale, entonces hablamos mañana."),                                     // A
		mk("Speaker 1", "en", `Okay, "hasta luego".`),                                                // B
	}
	refineByLanguage(sents, 2)
	want := []string{"Speaker 2", "Speaker 1", "Speaker 2", "Speaker 2", "Speaker 1", "Speaker 1", "Speaker 2", "Speaker 1"}
	for i, s := range sents {
		if s.Speaker != want[i] {
			t.Errorf("sentence %d %q: %s, want %s", i+1, s.Text, s.Speaker, want[i])
		}
	}
}

func TestRefineByLanguageSplitsOneLabelWhenTwoPeopleTalk(t *testing.T) {
	mk := func(lang, text string) *sentence { return &sentence{Speaker: "Speaker 1", Lang: lang, Text: text} }
	sents := []*sentence{mk("es", "Hola, ¿qué tal estás hoy?"), mk("en", "I am fine, thank you."), mk("es", "Me alegro mucho de verte."), mk("en", "Nice to see you too.")}
	refineByLanguage(sents, 2)
	if sents[0].Speaker == sents[1].Speaker || sents[0].Speaker != sents[2].Speaker || sents[1].Speaker != sents[3].Speaker {
		t.Errorf("not split by language: %s %s %s %s", sents[0].Speaker, sents[1].Speaker, sents[2].Speaker, sents[3].Speaker)
	}
	// Unknown number of people and one voice: a bilingual person is not split.
	one := []*sentence{mk("es", "Hola, ¿qué tal estás hoy?"), mk("en", "I am fine, thank you."), mk("es", "Me alegro mucho de verte."), mk("en", "Nice to see you too.")}
	refineByLanguage(one, 0)
	for _, s := range one {
		if s.Speaker != "Speaker 1" {
			t.Errorf("a single bilingual speaker was split: %s", s.Speaker)
		}
	}
}

// The exact labels of the real run (00:26): Together put 7 of 8 sentences under one voice.
func TestOneLanguagePerPersonWithTheRealLabels(t *testing.T) {
	mk := func(sp, lang, text string) *sentence { return &sentence{Speaker: sp, Lang: lang, Text: text} }
	sents := []*sentence{
		mk("Speaker 1", "es", `Mañana tenemos el "meeting" a las 10, no te olvides del "deadline".`),
		mk("Speaker 1", "en", "Sure, I will send you the report before the meeting."),
		mk("Speaker 1", "es", "Perfecto. Gracias."),
		mk("Speaker 2", "es", `Puedes revisar también el "budget" del proyecto.`),
		mk("Speaker 1", "en", "Yes, no problem."),
		mk("Speaker 1", "en", "I will check it tonight."),
		mk("Speaker 1", "es", "Vale, entonces hablamos mañana."),
		mk("Speaker 1", "en", `Okay, "Asta Luego".`),
	}
	refineByLanguage(sents, 2)
	for i, s := range sents {
		want := "Speaker 1" // the English voice keeps the label that holds most of its sentences
		if s.Lang == "es" {
			want = "Speaker 2"
		}
		if i == 2 {
			// "Perfecto. Gracias.": a short phrase from a known person follows the voice
			// (here the voice was wrong; with real voices it is usually right).
			want = "Speaker 1"
		}
		if s.Speaker != want {
			t.Errorf("sentence %d (%s) %q: %s, want %s", i+1, s.Lang, s.Text, s.Speaker, want)
		}
	}
	// Same voices, but only one language: the voices decide, nothing moves.
	same := []*sentence{mk("Speaker 1", "es", "Hola, ¿qué tal estás?"), mk("Speaker 2", "es", "Muy bien, gracias a ti."), mk("Speaker 1", "es", "Me alegro mucho, de verdad.")}
	if ch := refineByLanguage(same, 2); len(ch) != 0 {
		t.Errorf("one language, %d sentences moved", len(ch))
	}
}
