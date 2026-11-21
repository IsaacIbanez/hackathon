package captions

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// asrEvent is what the speech service reports: the sentence being spoken, or a finished one.
// Finished sentences carry their place in the audio when the service sends it (Timed): in
// seconds of the audio sent on this connection until pump converts them to session time.
type asrEvent struct {
	Final      bool
	Text       string
	Timed      bool
	Start, End float64
}

// asrStream is one realtime transcription connection.
type asrStream interface {
	Send(ctx context.Context, pcm []byte) error
	Commit(ctx context.Context) error // transcribe what was sent so far now
	Events() <-chan asrEvent
	Err() error // why Events was closed (nil after Close)
	Close()
}

// together talks to Together AI: realtime transcription, batch diarization and chat.
type together struct {
	cfg  Config
	http *http.Client
}

func newTogether(cfg Config) *together {
	return &together{cfg: cfg, http: &http.Client{Timeout: 120 * time.Second}}
}

// errUnauthorized means the API key was refused: retrying will not help.
var errUnauthorized = errors.New("the speech service refused the API key (401)")

// connect opens a realtime transcription session (OpenAI-style realtime protocol).
func (t *together) connect(ctx context.Context, lang string) (asrStream, error) {
	q := url.Values{}
	q.Set("model", t.cfg.ASRModel)
	q.Set("input_audio_format", "pcm_s16le_16000")
	if lang != "" && lang != "auto" {
		q.Set("language", lang)
	}
	h := http.Header{}
	h.Set("Authorization", "Bearer "+t.cfg.APIKey)
	h.Set("OpenAI-Beta", "realtime=v1")
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(dialCtx, t.cfg.RealtimeURL+"?"+q.Encode(), &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusUnauthorized {
			return nil, errUnauthorized
		}
		return nil, fmt.Errorf("connect to the speech service: %w", err)
	}
	c.SetReadLimit(1 << 20)
	s := &realtimeStream{c: c, events: make(chan asrEvent, 64)}
	go s.read(ctx)
	return s, nil
}

type realtimeStream struct {
	c      *websocket.Conn
	events chan asrEvent
	mu     sync.Mutex
	err    error
	closed bool
}

func (s *realtimeStream) Events() <-chan asrEvent { return s.events }

func (s *realtimeStream) Err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}

func (s *realtimeStream) Send(ctx context.Context, pcm []byte) error {
	msg, _ := json.Marshal(map[string]string{"type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(pcm)})
	return s.c.Write(ctx, websocket.MessageText, msg)
}

func (s *realtimeStream) Commit(ctx context.Context) error {
	return s.c.Write(ctx, websocket.MessageText, []byte(`{"type":"input_audio_buffer.commit"}`))
}

func (s *realtimeStream) Close() {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	_ = s.c.Close(websocket.StatusNormalClosure, "")
}

func (s *realtimeStream) fail(err error) {
	s.mu.Lock()
	if !s.closed && s.err == nil {
		s.err = err
	}
	s.mu.Unlock()
}

func (s *realtimeStream) read(ctx context.Context) {
	defer close(s.events)
	for {
		_, data, err := s.c.Read(ctx)
		if err != nil {
			s.fail(fmt.Errorf("speech service connection lost: %w", err))
			return
		}
		var ev struct {
			Type       string `json:"type"`
			Delta      string `json:"delta"`
			Transcript string `json:"transcript"`
			StartMs    *int64 `json:"audio_start_ms"`
			EndMs      *int64 `json:"audio_end_ms"`
			Message    string `json:"message"`
			Error      struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &ev) != nil {
			continue
		}
		switch ev.Type {
		case "conversation.item.input_audio_transcription.delta":
			s.events <- asrEvent{Text: ev.Delta}
		case "conversation.item.input_audio_transcription.completed":
			e := asrEvent{Final: true, Text: ev.Transcript}
			if ev.StartMs != nil && ev.EndMs != nil && *ev.EndMs >= *ev.StartMs {
				e.Timed, e.Start, e.End = true, float64(*ev.StartMs)/1000, float64(*ev.EndMs)/1000
			}
			s.events <- e
		case "error":
			msg := cmp(ev.Error.Message, ev.Message)
			if ev.Error.Code == "invalid_api_key" || ev.Error.Code == "missing_api_key" {
				s.fail(errUnauthorized)
			} else {
				s.fail(fmt.Errorf("speech service error: %s", msg))
			}
			_ = s.c.Close(websocket.StatusNormalClosure, "")
			return
		}
	}
}

func cmp(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// diarize transcribes a WAV with speaker labels; turn times are relative to the WAV start.
// speakers > 0 tells the service how many people talk: at most that many (exact = false, for
// short live windows where some may be silent) or exactly that many (the final pass).
func (t *together) diarize(ctx context.Context, wavData []byte, lang string, speakers int, exact bool) ([]turn, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	// Together asks for the model before the file in the multipart body.
	_ = mw.WriteField("model", t.cfg.DiarizeModel)
	_ = mw.WriteField("response_format", "verbose_json")
	_ = mw.WriteField("timestamp_granularities", "word")
	_ = mw.WriteField("diarize", "true")
	if speakers > 0 {
		_ = mw.WriteField("max_speakers", fmt.Sprint(speakers))
		if exact {
			_ = mw.WriteField("min_speakers", fmt.Sprint(speakers))
		}
	}
	if lang != "" && lang != "auto" {
		_ = mw.WriteField("language", lang)
	}
	fw, _ := mw.CreateFormFile("file", "audio.wav")
	_, _ = fw.Write(wavData)
	_ = mw.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.cfg.APIURL+"/audio/transcriptions", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+t.cfg.APIKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	var out struct {
		Words []struct {
			Start     float64 `json:"start"`
			End       float64 `json:"end"`
			SpeakerID string  `json:"speaker_id"`
		} `json:"words"`
		SpeakerSegments []struct {
			Start     float64 `json:"start"`
			End       float64 `json:"end"`
			SpeakerID string  `json:"speaker_id"`
		} `json:"speaker_segments"`
	}
	if err := t.do(req, &out); err != nil {
		return nil, fmt.Errorf("diarization: %w", err)
	}
	var turns []turn
	if len(out.SpeakerSegments) > 0 {
		for _, s := range out.SpeakerSegments {
			turns = append(turns, turn{span{s.Start, s.End}, s.SpeakerID})
		}
		return turns, nil
	}
	for _, w := range out.Words {
		if w.SpeakerID == "" {
			continue
		}
		if n := len(turns); n > 0 && turns[n-1].Speaker == w.SpeakerID {
			turns[n-1].End = w.End
			continue
		}
		turns = append(turns, turn{span{w.Start, w.End}, w.SpeakerID})
	}
	return turns, nil
}

var thinkBlock = regexp.MustCompile(`(?s)<think>.*?</think>`)

func (t *together) do(req *http.Request, out any) error {
	resp, err := t.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		return errUnauthorized
	}
	if resp.StatusCode/100 != 2 {
		msg := string(body)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, msg)
	}
	return json.Unmarshal(body, out)
}
