// Package captions serves GET /captions: live captions of the microphone or a call, with
// speakers and translation (role B1, Pau; brief in docs/briefs/pau.md).
//
// The browser streams raw PCM (s16le, 16 kHz, mono) over a WebSocket. Go relays it to a
// streaming speech-to-text service (Together AI realtime), labels speakers with a batch
// diarization pass every ~15 s of audio and once more over the whole recording when the
// session stops, translates each final sentence and saves the transcript as a .txt file.
// The API key never leaves Go.
package captions

import (
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

// Defaults (prices in USD, from Together's serverless price list, 2026-11).
const (
	DefaultRealtimeURL = "wss://api.together.ai/v1/realtime"
	DefaultAPIURL      = "https://api.together.ai/v1"
	// Parakeet v3: 25 European languages detected on its own, so people can mix languages
	// (Nemotron 3.5 split words and invented text when Spanish and English were mixed).
	DefaultASRModel = "nvidia/parakeet-tdt-0.6b-v3"
	// Batch diarization: Parakeet transcribes every language in the audio; Whisper keeps only
	// one, and Together labels speakers word by word, so the other language lost its speakers.
	DefaultDiarizeModel   = "nvidia/parakeet-tdt-0.6b-v3"
	DefaultTranslateModel = "Qwen/Qwen3.5-9B"
	DefaultLimitUSD       = 1.0
)

// asrPricePerMin is the realtime price per audio minute of the known models.
var asrPricePerMin = map[string]float64{
	"nvidia/nemotron-3.5-asr-streaming-0.6b": 0.0045,
	"nvidia/nemotron-3-asr-streaming-0.6b":   0.0045,
	"nvidia/parakeet-tdt-0.6b-v3":            0.0035,
	"openai/whisper-large-v3":                0.0035,
}

// Config of the captions service. The zero value of a field means "use the default".
type Config struct {
	APIKey         string // TOGETHER_API_KEY
	RealtimeURL    string // CAPTIONS_REALTIME_URL
	APIURL         string // CAPTIONS_API_URL (batch transcription and chat completions)
	ASRModel       string // CAPTIONS_ASR_MODEL
	DiarizeModel   string // CAPTIONS_DIARIZE_MODEL
	TranslateModel string // CAPTIONS_TRANSLATE_MODEL
	LimitUSD       float64
	Dir            string // CAPTIONS_DIR, where transcripts are saved (default ~/Documents/LauzHack)

	ASRPricePerMin      float64       // default: by model, else 0.0045
	DiarizePricePerMin  float64       // default 0.0015
	TranslateInPerMTok  float64       // default 0.17
	TranslateOutPerMTok float64       // default 0.25
	DiarizeEvery        time.Duration // live diarization step (audio time), default 15 s
	DiarizeOverlap      time.Duration // overlap between live windows, default 10 s
	FinalWindow         time.Duration // final pass window (upload limit is 80 MB), default 20 min
	SaveEvery           time.Duration // wall time between transcript saves, default 1 min
	PolishWait          time.Duration // how long a final waits for the language model, default 1.5 s
	RetryDelays         []time.Duration
	Now                 func() time.Time
}

// FromEnv reads the configuration from the environment and the .env files the LLM client
// also uses (values already set are never overridden).
func FromEnv() Config {
	for _, p := range llm.DotEnvCandidates() {
		llm.LoadDotEnv(p)
	}
	c := Config{
		APIKey:         os.Getenv("TOGETHER_API_KEY"),
		RealtimeURL:    os.Getenv("CAPTIONS_REALTIME_URL"),
		APIURL:         os.Getenv("CAPTIONS_API_URL"),
		ASRModel:       os.Getenv("CAPTIONS_ASR_MODEL"),
		DiarizeModel:   os.Getenv("CAPTIONS_DIARIZE_MODEL"),
		TranslateModel: os.Getenv("CAPTIONS_TRANSLATE_MODEL"),
		Dir:            os.Getenv("CAPTIONS_DIR"),
	}
	if v, err := strconv.ParseFloat(os.Getenv("CAPTIONS_LIMIT_USD"), 64); err == nil && v > 0 {
		c.LimitUSD = v
	}
	return c
}

func (c Config) withDefaults() Config {
	def := func(s *string, v string) {
		if *s == "" {
			*s = v
		}
	}
	def(&c.RealtimeURL, DefaultRealtimeURL)
	def(&c.APIURL, DefaultAPIURL)
	def(&c.ASRModel, DefaultASRModel)
	def(&c.DiarizeModel, DefaultDiarizeModel)
	def(&c.TranslateModel, DefaultTranslateModel)
	if c.Dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = os.TempDir()
		}
		c.Dir = filepath.Join(home, "Documents", "LauzHack")
	}
	if c.LimitUSD <= 0 {
		c.LimitUSD = DefaultLimitUSD
	}
	if c.ASRPricePerMin <= 0 {
		c.ASRPricePerMin = 0.0045
		if p, ok := asrPricePerMin[c.ASRModel]; ok {
			c.ASRPricePerMin = p
		}
	}
	if c.DiarizePricePerMin <= 0 {
		c.DiarizePricePerMin = 0.0015
	}
	if c.TranslateInPerMTok <= 0 {
		c.TranslateInPerMTok = 0.17
	}
	if c.TranslateOutPerMTok <= 0 {
		c.TranslateOutPerMTok = 0.25
	}
	if c.DiarizeEvery <= 0 {
		c.DiarizeEvery = 15 * time.Second
	}
	if c.DiarizeOverlap <= 0 {
		c.DiarizeOverlap = 30 * time.Second // 45 s windows: more shared speech to recognise voices
	}
	if c.FinalWindow <= 0 {
		c.FinalWindow = 20 * time.Minute
	}
	if c.PolishWait <= 0 {
		c.PolishWait = 1500 * time.Millisecond
	}
	if c.SaveEvery <= 0 {
		c.SaveEvery = time.Minute
	}
	if c.RetryDelays == nil {
		c.RetryDelays = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	return c
}
