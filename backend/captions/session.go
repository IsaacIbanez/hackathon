package captions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

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
	speakers, _ := strconv.Atoi(q.Get("speakers"))
	s := &session{
		cfg:      h.cfg,
		api:      newTogether(h.cfg),
		conn:     conn,
		lang:     cleanLang(q.Get("lang"), "auto"),
		target:   cleanLang(q.Get("target"), "none"),
		speakers: min(max(speakers, 0), 10),
		started:  h.cfg.Now(),
		audio:    make(chan chunk, 64),
		jobs:     make(chan *sentence, 256),
		flushReq: make(chan chan struct{}),
		stop:     make(chan struct{}),
	}
	s.run(r.Context())
}

type session struct {
	cfg      Config
	api      *together
	conn     *websocket.Conn
	lang     string
	speakers int // how many people talk, 0 = unknown
	started  time.Time
	path     string

	audio    chan chunk         // client audio for the speech service
	jobs     chan *sentence     // final sentences for the language model (in order)
	flushReq chan chan struct{} // ask the speech service to finish the current sentence
	stop     chan struct{}      // closed when the session must end (client stop or cost limit)
	stopOnce sync.Once

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
	langs      []string    // translation languages, in order of first use
	pending    []*sentence // sentences to check again now that we know who said them
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
	log.Printf("captions: %s: %s", code, msg)
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

	asrDone, saverDone, sentencesDone := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() { defer close(asrDone); s.runASR(liveCtx) }()
	go func() { defer close(saverDone); s.runSaver(liveCtx) }()
	go func() { defer close(sentencesDone); s.runSentences(base) }()

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
	<-asrDone // nothing sends to s.jobs after this
	close(s.jobs)
	select {
	case <-sentencesDone:
	case <-time.After(4 * flushWait):
	}
	s.mu.Lock()
	s.finalizing = true // late live diarization results must not overwrite the final labels
	s.mu.Unlock()
	s.finalDiarization(base)
	s.repolishPending(base, 30)
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
	at := secondsOf(len(s.recording))
	s.recording = append(s.recording, pcm...)
	s.vad.write(pcm)
	s.mu.Unlock()
	select {
	case s.audio <- chunk{pcm, at}:
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

// chunk is client audio and where it starts in the recording (seconds).
type chunk struct {
	pcm []byte
	at  float64
}

// streamClock converts times of one speech connection (seconds of audio sent on it) to
// session time. Audio dropped while reconnecting or when the service is slow leaves gaps in
// the recording that the connection does not see, so it keeps an anchor at each gap.
type streamClock struct {
	sent    float64
	anchors []clockAnchor
}

type clockAnchor struct{ stream, rec float64 }

func (c *streamClock) sending(at, sec float64) {
	n := len(c.anchors)
	if n == 0 || math.Abs(c.anchors[n-1].rec+(c.sent-c.anchors[n-1].stream)-at) > 0.005 {
		c.anchors = append(c.anchors, clockAnchor{c.sent, at})
	}
	c.sent += sec
}

func (c *streamClock) toSession(t float64) float64 {
	for i := len(c.anchors) - 1; i >= 0; i-- {
		if a := c.anchors[i]; a.stream <= t || i == 0 {
			return a.rec + t - a.stream
		}
	}
	return t
}

func (s *session) pump(ctx context.Context, stream asrStream) error {
	defer stream.Close()
	events := stream.Events()
	var clock streamClock
	for {
		select {
		case <-ctx.Done():
			return nil
		case c := <-s.audio:
			if err := stream.Send(ctx, c.pcm); err != nil {
				return fmt.Errorf("send audio: %w", err)
			}
			clock.sending(c.at, secondsOf(len(c.pcm)))
			s.mu.Lock()
			s.asrBytes += len(c.pcm)
			s.mu.Unlock()
			s.checkCost(false)
		case done := <-s.flushReq:
			s.mu.Lock()
			s.flushed = done
			s.mu.Unlock()
			// Half a second of silence and a commit make the service close the sentence.
			_ = stream.Send(ctx, make([]byte, bytesPerSecond/2))
			clock.sent += 0.5
			_ = stream.Commit(ctx)
		case ev, ok := <-events:
			if !ok {
				if err := stream.Err(); err != nil {
					return err
				}
				return errors.New("the speech service closed the connection")
			}
			if ev.Timed {
				ev.Start, ev.End = clock.toSession(ev.Start), clock.toSession(ev.End)
			}
			s.onASR(ev)
		}
	}
}

func (s *session) onASR(ev asrEvent) {
	ev.Text = cleanCaption(ev.Text)
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
	sent := s.addSentence(ev)
	if sent == nil {
		return
	}
	select {
	case s.jobs <- sent:
	default: // hundreds of sentences waiting: show it as it is
		s.emitFinal(sent)
	}
}

// emitFinal shows a sentence (once), with its speaker if known. A partial of the next sentence
// may have arrived meanwhile: it is sent again, because a final clears the partial on screen.
func (s *session) emitFinal(sent *sentence) {
	s.mu.Lock()
	if sent.shown {
		s.mu.Unlock()
		return
	}
	sent.shown = true
	ev := gen.CaptionsEvent{Type: gen.CaptionsEventTypeFinal, Id: ptr(sent.ID), Start: ptr(round2(sent.Start)), Text: ptr(sent.Text)}
	if sent.Lang != "" {
		ev.Lang = ptr(sent.Lang)
	}
	speaker, partial := sent.Speaker, s.partial
	s.mu.Unlock()
	s.emit(ev)
	if speaker != "" {
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeSpeaker, Id: ptr(sent.ID), Speaker: &speaker})
	}
	if partial != "" {
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypePartial, Text: &partial})
	}
}

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

// addSentence records a final sentence (nil if it is empty) and wakes a pending flush. Its
// place in time is the service's (which includes the silence before it), narrowed to the
// voice the detector heard; without the service's times, the voice since the last sentence.
func (s *session) addSentence(ev asrEvent) *sentence {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.partial = ""
	if s.flushed != nil {
		close(s.flushed)
		s.flushed = nil
	}
	if ev.Text == "" {
		return nil
	}
	var sp span
	if ev.Timed {
		sp = s.vad.sentenceSpan(max(ev.Start, s.lastEnd), max(ev.End, ev.Start))
	} else {
		sp = s.vad.sentenceSpan(s.lastEnd, secondsOf(len(s.recording)))
	}
	s.lastEnd = max(s.lastEnd, sp.End)
	sent := &sentence{ID: fmt.Sprintf("s%d", len(s.sentences)+1), span: sp, Text: ev.Text, Translations: map[string]string{}}
	sent.Speaker = s.live.speakerOf(sp)
	s.sentences = append(s.sentences, sent)
	s.dirty = true
	return sent
}

var (
	dotRuns      = regexp.MustCompile(`(\s*\.){2,}`)
	leadingNoise = regexp.MustCompile(`^[\s.,·…]+`)
)

// cleanCaption removes what the speech service adds around silences (" . .  El 15", " . . ")
// and extra spaces; text without a letter or digit is empty.
func cleanCaption(t string) string {
	t = dotRuns.ReplaceAllString(t, " ")
	t = leadingNoise.ReplaceAllString(t, "")
	t = strings.Join(strings.Fields(t), " ")
	if strings.IndexFunc(t, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) < 0 {
		return ""
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

// --- language, barbarisms and translation ---

// runSentences sends each final sentence, in order, to the language model, and in between
// re-checks the sentences whose speaker turned out to usually speak another language.
func (s *session) runSentences(ctx context.Context) {
	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case sent, ok := <-s.jobs:
			if !ok {
				return
			}
			s.process(ctx, sent)
		case <-tick.C:
			s.repolishPending(ctx, 3)
		}
	}
}

// contextLines is how many previous sentences the model sees.
const contextLines = 6

// polishInputFor builds the model's input for sent and remembers which speaker it assumed.
func (s *session) polishInputFor(sent *sentence) (polishInput, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.limitHit {
		return polishInput{}, false
	}
	in := polishInput{Speaker: "unknown", SpeakerLang: "unknown", Target: s.target, Sentence: sent.Text}
	i := len(s.sentences)
	for j, x := range s.sentences {
		if x == sent {
			i = j
		}
	}
	for _, x := range s.sentences[max(0, i-contextLines):i] {
		in.Conversation = append(in.Conversation, contextLine{Speaker: x.Speaker, Lang: x.Lang, Text: x.Text})
	}
	if sent.Speaker != "" {
		in.Speaker = sent.Speaker
		if l := usualLanguage(s.sentences, sent.Speaker, sent); l != "" {
			in.SpeakerLang = l
		}
	}
	sent.polishedFor = sent.Speaker
	return in, true
}

// process checks one new sentence. It is shown as soon as the model answers, or after
// PolishWait with the raw text (the improved one follows as `revise`).
func (s *session) process(ctx context.Context, sent *sentence) {
	in, ok := s.polishInputFor(sent)
	if !ok {
		s.emitFinal(sent)
		return
	}
	type answer struct {
		res polishResult
		err error
	}
	ch := make(chan answer, 1)
	go func() {
		pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		res, a, b, err := s.api.polish(pctx, in)
		s.mu.Lock()
		s.tokIn += a
		s.tokOut += b
		s.mu.Unlock()
		ch <- answer{res, err}
	}()
	var ans answer
	select {
	case ans = <-ch:
	case <-time.After(s.cfg.PolishWait):
		s.emitFinal(sent)
		ans = <-ch
	}
	s.applyPolish(sent, in.Target, ans.res, ans.err, false)
	s.checkCost(true)
}

// applyPolish keeps the model's language and quotes (only if it did not change any word) and
// its translation, and tells the client what changed. A second look (again, once the speaker
// is known) only counts if it changes the language and marks foreign words: a second answer
// that merely drops or moves quotes, or relabels a sentence without quoting anything, is noise.
func (s *session) applyPolish(sent *sentence, target string, res polishResult, err error, again bool) {
	if err != nil {
		s.emitError(gen.CaptionsEventCodeTranslation, "Language check and translation unavailable: "+err.Error(), true)
		s.emitFinal(sent)
		return
	}
	if again && (res.Lang == "" || res.Lang == sent.Lang || !strings.ContainsAny(res.Text, quoteMarks)) {
		return
	}
	s.mu.Lock()
	changed := false
	if res.Lang != "" && res.Lang != sent.Lang {
		sent.Lang, changed = res.Lang, true
	}
	if res.Text != "" && res.Text != sent.Text && sameWords(sent.Text, res.Text) {
		sent.Text, changed = res.Text, true
	}
	tr, newTr := "", false
	if target != "none" {
		tr = res.Translation
		if sent.Lang == target || (tr == "" && sent.Lang == "") {
			tr = sent.Text // already in the target language
		}
		if tr != "" && tr != sent.Translations[target] {
			sent.Translations[target] = tr
			newTr = true
			if !contains(s.langs, target) {
				s.langs = append(s.langs, target)
			}
		}
	}
	if changed || newTr {
		s.dirty = true
	}
	shown := sent.shown
	id, text, lang := sent.ID, sent.Text, sent.Lang
	s.mu.Unlock()
	switch {
	case !shown:
		s.emitFinal(sent)
	case changed:
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeRevise, Id: &id, Text: &text, Lang: &lang})
	}
	if newTr {
		s.emit(gen.CaptionsEvent{Type: gen.CaptionsEventTypeTranslation, Id: &id, Lang: &target, Text: &tr})
	} else if target != "none" && tr == "" {
		s.emitError(gen.CaptionsEventCodeTranslation, "Translation unavailable for one sentence", true)
	}
}

// queueRepolish marks for a second look the sentences whose speaker usually speaks another
// language than the one the model chose without knowing who said it ("Okay, hasta luego"
// from an English speaker is English with a Spanish phrase). Call with s.mu held.
func (s *session) queueRepolish(changed []*sentence) {
	for _, sent := range changed {
		if sent.Lang == "" || sent.Speaker == "" || sent.polishedFor == sent.Speaker || contains2(s.pending, sent) {
			continue
		}
		if usual := usualLanguage(s.sentences, sent.Speaker, sent); usual != "" && usual != sent.Lang {
			s.pending = append(s.pending, sent)
		}
	}
}

func contains2(list []*sentence, v *sentence) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// repolishPending checks again up to n queued sentences, with their speaker as context.
func (s *session) repolishPending(ctx context.Context, n int) {
	for range n {
		s.mu.Lock()
		if len(s.pending) == 0 {
			s.mu.Unlock()
			return
		}
		sent := s.pending[0]
		s.pending = s.pending[1:]
		s.mu.Unlock()
		in, ok := s.polishInputFor(sent)
		if !ok {
			return
		}
		pctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		res, a, b, err := s.api.polish(pctx, in)
		cancel()
		s.mu.Lock()
		s.tokIn += a
		s.tokOut += b
		s.mu.Unlock()
		s.applyPolish(sent, in.Target, res, err, true)
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
		turns, err := s.api.diarize(dctx, wav(pcm), s.lang, s.speakers, false)
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
		changed := append(s.relabel(&s.live, span{from, to}), refineByLanguage(s.sentences, s.speakers)...)
		s.queueRepolish(changed)
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
		turns, err := s.api.diarize(dctx, wav(pcm), s.lang, s.speakers, true)
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
	final.alignTo(s.sentences)
	changed := append(s.relabel(&final, span{0, total}), refineByLanguage(s.sentences, s.speakers)...)
	s.queueRepolish(s.sentences)
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
