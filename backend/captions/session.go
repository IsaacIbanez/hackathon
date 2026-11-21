package captions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/coder/websocket"
)

// Handler serves GET /captions (see api/openapi.yaml). One WebSocket = one session.
type Handler struct {
	cfg     Config
	origins []string
}

// New returns the /captions handler. originPatterns are the browser origins allowed to open
// the WebSocket (the same ones as /ws).
func New(cfg Config, originPatterns []string) *Handler {
	return &Handler{cfg: cfg.withDefaults(), origins: originPatterns}
}

var langCode = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$`)

func cleanLang(v, fallback string) string {
	if v == "" || !langCode.MatchString(v) {
		return fallback
	}
	return v
}

const (
	maxRecordingSec = 3 * 60 * 60 // keep at most 3 h of audio in memory (~350 MB)
	finalOverlapSec = 60.0
	flushWait       = 3 * time.Second
)

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	q := r.URL.Query()
	s := &session{
		cfg:       h.cfg,
		api:       newTogether(h.cfg),
		conn:      conn,
		lang:      cleanLang(q.Get("lang"), "auto"),
		target:    cleanLang(q.Get("target"), "none"),
		started:   h.cfg.Now(),
		audio:     make(chan []byte, 64),
		translate: make(chan *sentence, 256),
		flushReq:  make(chan chan struct{}),
		stop:      make(chan struct{}),
		cache:     map[string]string{},
	}
	s.run(r.Context())
}

type session struct {
	cfg     Config
	api     *together
	conn    *websocket.Conn
	lang    string
	started time.Time
	path    string

	audio     chan []byte        // client audio for the speech service
	translate chan *sentence     // final sentences to translate
	flushReq  chan chan struct{} // ask the speech service to finish the current sentence
	stop      chan struct{}      // closed when the session must end (client stop or cost limit)
	stopOnce  sync.Once

	mu         sync.Mutex
	target     string
	recording  []byte
	vad        voiceDetector
	sentences  []*sentence
	lastEnd    float64
	partial    string
	flushed    chan struct{} // closed by the next final sentence while flushing
	live       speakerMap
	diarBusy   bool
	langs      []string // translation languages, in order of first use
	cache      map[string]string
	asrBytes   int
	diarSec    float64
	tokIn      int
	tokOut     int
	lastCost   float64
	limitHit   bool
	finalizing bool
	dirty      bool
}

// emit sends one event to the client. coder/websocket allows concurrent writes.
func (s *session) emit(ev gen.CaptionsEvent) {
	data, _ := json.Marshal(ev)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.conn.Write(ctx, websocket.MessageText, data)
}

func ptr[T any](v T) *T { return &v }

func (s *session) emitError(code gen.CaptionsEventCode, msg string, retryable bool) {
	s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeError, Code: &code, Message: &msg, Retryable: &retryable})
}

func (s *session) end() { s.stopOnce.Do(func() { close(s.stop) }) }

func (s *session) run(reqCtx context.Context) {
	defer s.conn.CloseNow()
	if s.cfg.APIKey == "" {
		s.emitError(gen.CaptionsEventCodeNoKey, "Live captions need TOGETHER_API_KEY in .env", false)
		_ = s.conn.Close(websocket.StatusNormalClosure, "no API key")
		return
	}
	s.path = transcriptPath(s.cfg.Dir, s.started)
	// The session outlives the request context: after the client leaves, Go still finishes
	// the transcript.
	base := context.WithoutCancel(reqCtx)
	liveCtx, stopLive := context.WithCancel(base)
	defer stopLive()

	asrDone, saverDone, translateDone := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() { defer close(asrDone); s.runASR(liveCtx) }()
	go func() { defer close(saverDone); s.runSaver(liveCtx) }()
	go func() { defer close(translateDone); s.runTranslations(base) }()

	clientGone := make(chan struct{})
	go func() {
		defer close(clientGone)
		s.readClient(base)
	}()
	select {
	case <-s.stop:
	case <-clientGone:
		s.end()
	}

	s.flushASR(liveCtx)
	stopLive()
	<-asrDone // nothing sends to s.translate after this
	close(s.translate)
	select {
	case <-translateDone:
	case <-time.After(2 * flushWait):
	}
	s.mu.Lock()
	s.finalizing = true // late live diarization results must not overwrite the final labels
	s.mu.Unlock()
	s.finalDiarization(base)
	s.save()
	<-saverDone
	_ = s.conn.Close(websocket.StatusNormalClosure, "")
}

func (s *session) readClient(ctx context.Context) {
	for {
		typ, data, err := s.conn.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			s.addAudio(ctx, data)
			continue
		}
		var msg gen.CaptionsClientMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case gen.Config:
			if msg.Target != nil {
				s.mu.Lock()
				s.target = cleanLang(*msg.Target, "none")
				s.mu.Unlock()
			}
		case gen.Stop:
			s.end()
			return
		}
	}
}

func (s *session) addAudio(ctx context.Context, pcm []byte) {
	if len(pcm)%2 == 1 {
		pcm = pcm[:len(pcm)-1]
	}
	s.mu.Lock()
	if secondsOf(len(s.recording)) >= maxRecordingSec || s.limitHit {
		s.mu.Unlock()
		return
	}
	s.recording = append(s.recording, pcm...)
	s.vad.write(pcm)
	s.mu.Unlock()
	select {
	case s.audio <- pcm:
	default: // the speech service is reconnecting or slow: the audio is still recorded
	}
	s.maybeDiarize(ctx)
}

// --- speech service ---

func (s *session) runASR(ctx context.Context) {
	failures := 0
	for ctx.Err() == nil {
		stream, err := s.api.connect(ctx, s.lang)
		if err == nil {
			s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeReady, Model: &s.cfg.ASRModel, Lang: &s.lang, Target: ptr(s.currentTarget())})
			began := time.Now()
			err = s.pump(ctx, stream)
			if ctx.Err() != nil || err == nil {
				return
			}
			if time.Since(began) > 10*time.Second {
				failures = 0
			}
		}
		if errors.Is(err, errUnauthorized) {
			s.emitError(gen.CaptionsEventCodeUpstream, err.Error(), false)
			return
		}
		if failures >= len(s.cfg.RetryDelays) {
			s.emitError(gen.CaptionsEventCodeUpstream, "The live captions service is not answering: "+err.Error(), false)
			return
		}
		s.emitError(gen.CaptionsEventCodeUpstream, fmt.Sprintf("Lost the live captions service, retrying (%d/%d)", failures+1, len(s.cfg.RetryDelays)), true)
		select {
		case <-time.After(s.cfg.RetryDelays[failures]):
		case <-ctx.Done():
			return
		}
		failures++
	}
}

func (s *session) currentTarget() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.target
}

func (s *session) pump(ctx context.Context, stream asrStream) error {
	defer stream.Close()
	events := stream.Events()
	for {
		select {
		case <-ctx.Done():
			return nil
		case pcm := <-s.audio:
			if err := stream.Send(ctx, pcm); err != nil {
				return fmt.Errorf("send audio: %w", err)
			}
			s.mu.Lock()
			s.asrBytes += len(pcm)
			s.mu.Unlock()
			s.checkCost(false)
		case done := <-s.flushReq:
			s.mu.Lock()
			s.flushed = done
			s.mu.Unlock()
			// Half a second of silence and a commit make the service close the sentence.
			_ = stream.Send(ctx, make([]byte, bytesPerSecond/2))
			_ = stream.Commit(ctx)
		case ev, ok := <-events:
			if !ok {
				if err := stream.Err(); err != nil {
					return err
				}
				return errors.New("the speech service closed the connection")
			}
			s.onASR(ev)
		}
	}
}

func (s *session) onASR(ev asrEvent) {
	if !ev.Final {
		s.mu.Lock()
		changed := ev.Text != s.partial
		s.partial = ev.Text
		s.mu.Unlock()
		if changed {
			s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypePartial, Text: ptr(ev.Text)})
		}
		return
	}
	sent := s.addSentence(ev.Text)
	if sent == nil {
		return
	}
	ev2 := gen.CaptionsEvent{Type: gen.CaptionsEventTypeFinal, Id: &sent.ID, Start: ptr(round2(sent.Start)), Text: &sent.Text}
	s.emit(ev2)
	if sent.Speaker != "" {
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeSpeaker, Id: &sent.ID, Speaker: &sent.Speaker})
	}
	select {
	case s.translate <- sent:
	default:
	}
}

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

// addSentence records a final sentence (nil if it is empty) and wakes a pending flush.
func (s *session) addSentence(text string) *sentence {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.partial = ""
	if s.flushed != nil {
		close(s.flushed)
		s.flushed = nil
	}
	if text = trimSpace(text); text == "" {
		return nil
	}
	at := secondsOf(len(s.recording))
	sp := s.vad.sentenceSpan(s.lastEnd, at)
	s.lastEnd = sp.End
	sent := &sentence{ID: fmt.Sprintf("s%d", len(s.sentences)+1), span: sp, Text: text, Translations: map[string]string{}}
	sent.Speaker = s.live.speakerOf(sp)
	s.sentences = append(s.sentences, sent)
	s.dirty = true
	return sent
}

func trimSpace(t string) string {
	for len(t) > 0 && (t[0] == ' ' || t[0] == '\n' || t[0] == '\t') {
		t = t[1:]
	}
	for len(t) > 0 && (t[len(t)-1] == ' ' || t[len(t)-1] == '\n' || t[len(t)-1] == '\t') {
		t = t[:len(t)-1]
	}
	return t
}

// flushASR asks the speech service to finish the sentence in progress and waits a little for
// it; whatever is still only partial becomes a final sentence, so nothing said is lost.
func (s *session) flushASR(ctx context.Context) {
	done := make(chan struct{})
	select {
	case s.flushReq <- done:
		select {
		case <-done:
		case <-time.After(flushWait):
		case <-ctx.Done():
		}
	case <-time.After(200 * time.Millisecond): // no live connection
	}
	s.mu.Lock()
	partial := s.partial
	s.flushed = nil
	s.mu.Unlock()
	if partial != "" {
		s.onASR(asrEvent{Final: true, Text: partial})
	}
}

// --- translation ---

func (s *session) runTranslations(ctx context.Context) {
	for sent := range s.translate {
		target := s.currentTarget()
		if target == "none" || ctx.Err() != nil {
			continue
		}
		s.mu.Lock()
		cached, ok := s.cache[target+"\x00"+sent.Text]
		limit := s.limitHit
		s.mu.Unlock()
		if limit {
			continue
		}
		text := cached
		if !ok {
			tctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			tr, in, out, err := s.api.translate(tctx, sent.Text, target)
			cancel()
			s.mu.Lock()
			s.tokIn += in
			s.tokOut += out
			s.mu.Unlock()
			if err != nil {
				s.emitError(gen.CaptionsEventCodeTranslation, "Translation unavailable: "+err.Error(), true)
				continue
			}
			text = tr
		}
		s.mu.Lock()
		s.cache[target+"\x00"+sent.Text] = text
		sent.Translations[target] = text
		if !contains(s.langs, target) {
			s.langs = append(s.langs, target)
		}
		s.dirty = true
		s.mu.Unlock()
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeTranslation, Id: &sent.ID, Lang: &target, Text: &text})
		s.checkCost(true)
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// --- speakers ---

// maybeDiarize starts a live diarization window when DiarizeEvery seconds of new audio have
// arrived since the last one (one request at a time; windows overlap by DiarizeOverlap).
func (s *session) maybeDiarize(ctx context.Context) {
	s.mu.Lock()
	now := secondsOf(len(s.recording))
	every, ov := s.cfg.DiarizeEvery.Seconds(), s.cfg.DiarizeOverlap.Seconds()
	if s.diarBusy || s.limitHit || s.finalizing || now-s.live.covered < every {
		s.mu.Unlock()
		return
	}
	from := max(0, s.live.covered-ov)
	pcm := append([]byte(nil), s.recording[byteAt(from):]...)
	s.diarBusy = true
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			s.diarBusy = false
			s.mu.Unlock()
		}()
		dctx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		turns, err := s.api.diarize(dctx, wav(pcm), s.lang)
		to := from + secondsOf(len(pcm))
		s.mu.Lock()
		s.diarSec += to - from
		s.mu.Unlock()
		s.checkCost(true)
		if err != nil {
			if ctx.Err() == nil {
				s.emitError(gen.CaptionsEventCodeDiarization, "Could not tell who is speaking: "+err.Error(), true)
			}
			return
		}
		s.mu.Lock()
		if s.finalizing {
			s.mu.Unlock()
			return
		}
		s.live.add(from, to, shift(turns, from))
		changed := s.relabel(&s.live, span{from, to})
		s.mu.Unlock()
		s.emitSpeakers(changed)
	}()
}

func shift(turns []turn, by float64) []turn {
	out := make([]turn, len(turns))
	for i, t := range turns {
		out[i] = turn{span{t.Start + by, t.End + by}, t.Speaker}
	}
	return out
}

// relabel gives each sentence that overlaps `in` the speaker m says; it returns the changed
// ones. Call with s.mu held.
func (s *session) relabel(m *speakerMap, in span) []*sentence {
	var changed []*sentence
	for _, sent := range s.sentences {
		if overlap(sent.span, in) <= 0 && !(sent.Start == sent.End && sent.Start >= in.Start && sent.Start <= in.End) {
			continue
		}
		if sp := m.speakerOf(sent.span); sp != "" && sp != sent.Speaker {
			sent.Speaker = sp
			changed = append(changed, sent)
		}
	}
	if len(changed) > 0 {
		s.dirty = true
	}
	return changed
}

func (s *session) emitSpeakers(changed []*sentence) {
	for _, sent := range changed {
		s.mu.Lock()
		id, sp := sent.ID, sent.Speaker
		s.mu.Unlock()
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeSpeaker, Id: &id, Speaker: &sp})
	}
}

// finalDiarization labels the whole recording again, in windows the upload limit allows,
// so the saved transcript has consistent speakers. Skipped if it would pass the cost limit.
func (s *session) finalDiarization(ctx context.Context) {
	s.mu.Lock()
	total := secondsOf(len(s.recording))
	n := len(s.sentences)
	estimate := total / 60 * s.cfg.DiarizePricePerMin
	over := s.limitHit || s.costLocked()+estimate > s.cfg.LimitUSD
	s.mu.Unlock()
	if n == 0 || total < 1 {
		return
	}
	if over {
		s.emitError(gen.CaptionsEventCodeDiarization, "Skipped the final speaker pass: it would pass the cost limit", false)
		return
	}
	var final speakerMap
	win := s.cfg.FinalWindow.Seconds()
	for from := 0.0; from < total; {
		to := min(total, from+win)
		s.mu.Lock()
		pcm := append([]byte(nil), s.recording[byteAt(from):byteAt(to)]...)
		s.mu.Unlock()
		dctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		turns, err := s.api.diarize(dctx, wav(pcm), s.lang)
		cancel()
		s.mu.Lock()
		s.diarSec += to - from
		s.mu.Unlock()
		if err != nil {
			s.emitError(gen.CaptionsEventCodeDiarization, "Final speaker pass failed, keeping the live labels: "+err.Error(), false)
			s.checkCost(true)
			return
		}
		final.add(from, to, shift(turns, from))
		if to >= total {
			break
		}
		from = to - finalOverlapSec
	}
	s.mu.Lock()
	changed := s.relabel(&final, span{0, total})
	s.mu.Unlock()
	s.emitSpeakers(changed)
	s.checkCost(true)
}

// --- cost and saving ---

func (s *session) costLocked() float64 {
	return secondsOf(s.asrBytes)/60*s.cfg.ASRPricePerMin +
		s.diarSec/60*s.cfg.DiarizePricePerMin +
		float64(s.tokIn)/1e6*s.cfg.TranslateInPerMTok +
		float64(s.tokOut)/1e6*s.cfg.TranslateOutPerMTok
}

// checkCost sends the running cost (every 0.0005 USD, or when forced) and ends the session
// when it reaches the limit.
func (s *session) checkCost(force bool) {
	s.mu.Lock()
	cost := s.costLocked()
	send := force || cost-s.lastCost >= 0.0005
	if send {
		s.lastCost = cost
	}
	hit := !s.limitHit && cost >= s.cfg.LimitUSD
	if hit {
		s.limitHit = true
	}
	s.mu.Unlock()
	if send || hit {
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeCost, CostUsd: ptr(round6(cost)), LimitUsd: &s.cfg.LimitUSD})
	}
	if hit {
		s.emitError(gen.CaptionsEventCodeLimitReached, fmt.Sprintf("Reached the cost limit of this session (%.2f USD): captions stopped", s.cfg.LimitUSD), false)
		s.end()
	}
}

func round6(v float64) float64 { return float64(int64(v*1e6+0.5)) / 1e6 }

func (s *session) runSaver(ctx context.Context) {
	t := time.NewTicker(s.cfg.SaveEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.mu.Lock()
			dirty := s.dirty
			s.mu.Unlock()
			if dirty {
				s.save()
			}
		}
	}
}

func (s *session) save() {
	s.mu.Lock()
	if len(s.sentences) == 0 {
		s.mu.Unlock()
		return
	}
	text := renderTranscript(s.started, s.lang, s.langs, s.sentences)
	s.dirty = false
	s.mu.Unlock()
	if err := writeFileAtomic(s.path, []byte(text)); err != nil {
		log.Printf("captions: could not save the transcript: %v", err)
		return
	}
	s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeSaved, Path: &s.path})
}
