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
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// asrEvent is what the speech service reports: the sentence being spoken, or a finished one.
type asrEvent struct {
	Final bool
	Text  string
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
			s.events <- asrEvent{Final: true, Text: ev.Transcript}
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
func (t *together) diarize(ctx context.Context, wavData []byte, lang string) ([]turn, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	// Together asks for the model before the file in the multipart body.
	_ = mw.WriteField("model", t.cfg.DiarizeModel)
	_ = mw.WriteField("response_format", "verbose_json")
	_ = mw.WriteField("timestamp_granularities", "word")
	_ = mw.WriteField("diarize", "true")
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

// languageNames are used in the translation prompt (other codes are passed as they are).
var languageNames = map[string]string{
	"en": "English", "es": "Spanish", "ca": "Catalan", "fr": "French", "de": "German",
	"it": "Italian", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "ro": "Romanian",
	"uk": "Ukrainian", "ru": "Russian", "zh": "Chinese", "ja": "Japanese", "ar": "Arabic",
}

func languageName(code string) string {
	if n, ok := languageNames[strings.ToLower(code)]; ok {
		return n
	}
	return code
}

var thinkBlock = regexp.MustCompile(`(?s)<think>.*?</think>`)

// translate returns the translation of one caption and the tokens it used.
func (t *together) translate(ctx context.Context, text, target string) (string, int, int, error) {
	lang := languageName(target)
	reqBody := map[string]any{
		"model": t.cfg.TranslateModel,
		"messages": []map[string]string{
			{"role": "system", "content": "You translate live captions of a meeting. Translate the user's text into " + lang +
				". Reply with the translation only: no quotes, notes or explanations. If the text is already in " + lang + ", repeat it unchanged."},
			{"role": "user", "content": text},
		},
		"temperature": 0,
		"max_tokens":  400,
	}
	data, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.cfg.APIURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return "", 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+t.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Prompt     int `json:"prompt_tokens"`
			Completion int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := t.do(req, &out); err != nil {
		return "", 0, 0, fmt.Errorf("translation: %w", err)
	}
	if len(out.Choices) == 0 {
		return "", out.Usage.Prompt, out.Usage.Completion, errors.New("translation: empty answer")
	}
	tr := strings.TrimSpace(thinkBlock.ReplaceAllString(out.Choices[0].Message.Content, ""))
	return strings.Trim(tr, `"`), out.Usage.Prompt, out.Usage.Completion, nil
}

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
