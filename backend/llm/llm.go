// Package llm is the frugal model client (OpenRouter): two tiers (cheap and expensive),
// an in-memory cache and a cost and latency meter.
//
// The caller (role B2) decides when to escalate to the expensive model, through
// CompleteWithEscalation and its doubt function. This package only provides the mechanism.
package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Tier is the model tier.
type Tier string

const (
	Cheap     Tier = "cheap"
	Expensive Tier = "expensive"
)

// Default models (OpenRouter prices on 2026-11-21, USD per million input/output tokens).
// Both accept images. Override with LLM_CHEAP_MODEL and LLM_EXPENSIVE_MODEL.
const (
	DefaultCheapModel     = "anthropic/claude-haiku-5.5"  // 0.10 / 0.50
	DefaultExpensiveModel = "anthropic/claude-sonnet-5.5" // 2 / 10
	DefaultURL            = "https://openrouter.ai/api/v1"
)

// Development profile (LLM_PROFILE=dev): free vision models first and, when they are
// rate-limited (429), Haiku as a very cheap last resort, so development does not burn the
// AXA budget. Checked on 2026-11-21: nemotron handles text and images well; :free models
// often return 429, hence several of them.
const (
	DevCheapModels     = "nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free," + DefaultCheapModel
	DevExpensiveModels = DefaultCheapModel
)

// Message is one conversation turn. Images are URLs or data URLs
// ("data:image/jpeg;base64,...") for multimodal models.
type Message struct {
	Role   string   `json:"role"` // "user" or "assistant"
	Text   string   `json:"text"`
	Images []string `json:"images,omitempty"`
	Audio  *Audio   `json:"audio,omitempty"`
}

// Audio is a recording sent to an audio-capable model (for example, to transcribe it).
type Audio struct {
	Data   []byte `json:"data"`   // the file's bytes (sent base64-encoded)
	Format string `json:"format"` // "wav" or "mp3"
}

// Request is a model request.
type Request struct {
	Tier      Tier      `json:"tier"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`
	MaxTokens int       `json:"maxTokens,omitempty"` // 0 = 1024
	JSON      bool      `json:"json,omitempty"`      // ask for a JSON object answer
	// Models overrides the tier's models (same comma-separated syntax); the cost is still
	// counted under Tier. Used for tasks that need a specific capability, such as audio.
	Models string `json:"models,omitempty"`
}

// Response is the answer, with what it cost.
type Response struct {
	Text             string        `json:"text"`
	Model            string        `json:"model"`
	Tier             Tier          `json:"tier"`
	CostUSD          float64       `json:"costUsd"` // 0 when served from the cache
	Latency          time.Duration `json:"-"`
	LatencyMs        int64         `json:"latencyMs"`
	Cached           bool          `json:"cached"`
	PromptTokens     int           `json:"promptTokens"`
	CompletionTokens int           `json:"completionTokens"`
}

// ErrNoAPIKey means OPENROUTER_API_KEY is missing.
var ErrNoAPIKey = errors.New("llm: OPENROUTER_API_KEY environment variable is not set")

// Client talks to OpenRouter (OpenAI-compatible API).
type Client struct {
	BaseURL string
	APIKey  string
	// Models holds the model of each tier. It accepts a comma-separated list: if one
	// fails (rate-limited, down or empty answer) the next one is tried.
	Models map[Tier]string
	HTTP   *http.Client
	Cache  *Cache // nil = no cache
	Meter  *Meter // never nil when created with New
}

// New creates a client with a cache and a meter.
func New(apiKey string) *Client {
	return &Client{
		BaseURL: DefaultURL,
		APIKey:  apiKey,
		Models:  map[Tier]string{Cheap: DefaultCheapModel, Expensive: DefaultExpensiveModel},
		HTTP:    &http.Client{Timeout: 90 * time.Second},
		Cache:   NewCache(500),
		Meter:   &Meter{},
	}
}

// NewFromEnv reads the configuration from the environment and from the first .env files
// found (see DotEnvCandidates; values already set are never overridden):
// OPENROUTER_API_KEY and, optionally, LLM_PROFILE (dev), LLM_CHEAP_MODEL,
// LLM_EXPENSIVE_MODEL and OPENROUTER_URL.
func NewFromEnv() (*Client, error) {
	for _, p := range DotEnvCandidates() {
		LoadDotEnv(p)
	}
	key := os.Getenv("OPENROUTER_API_KEY")
	if key == "" {
		return nil, ErrNoAPIKey
	}
	c := New(key)
	if os.Getenv("LLM_PROFILE") == "dev" {
		c.Models[Cheap] = DevCheapModels
		c.Models[Expensive] = DevExpensiveModels
	}
	if v := os.Getenv("LLM_CHEAP_MODEL"); v != "" {
		c.Models[Cheap] = v
	}
	if v := os.Getenv("LLM_EXPENSIVE_MODEL"); v != "" {
		c.Models[Expensive] = v
	}
	if v := os.Getenv("OPENROUTER_URL"); v != "" {
		c.BaseURL = v
	}
	return c, nil
}

// Complete sends a request. If the exact same request was already made, it answers
// from the cache at no cost.
func (c *Client) Complete(ctx context.Context, req Request) (Response, error) {
	if req.Tier == "" {
		req.Tier = Cheap
	}
	model, ok := c.Models[req.Tier]
	if req.Models != "" {
		model, ok = req.Models, true
	}
	if !ok {
		return Response{}, fmt.Errorf("llm: unknown tier %q", req.Tier)
	}

	key := cacheKey(model, req)
	if c.Cache != nil {
		if r, ok := c.Cache.Get(key); ok {
			r.Cached, r.CostUSD, r.Latency, r.LatencyMs = true, 0, 0, 0
			c.meter().Record(r)
			return r, nil
		}
	}

	start := time.Now()
	var r Response
	var err error
	for _, m := range strings.Split(model, ",") {
		r, err = c.call(ctx, strings.TrimSpace(m), req)
		if err == nil {
			break
		}
		c.meter().RecordError(req.Tier)
		if ctx.Err() != nil {
			break
		}
	}
	if err != nil {
		return Response{}, err
	}
	r.Latency = time.Since(start)
	r.LatencyMs = r.Latency.Milliseconds()
	r.Tier = req.Tier
	c.meter().Record(r)
	if c.Cache != nil {
		c.Cache.Put(key, r)
	}
	return r, nil
}

// CompleteWithEscalation tries the cheap model first and, if doubt(response) is true,
// repeats the request with the expensive one. It returns the final response and whether
// it escalated. It also escalates when the cheap model fails.
func (c *Client) CompleteWithEscalation(ctx context.Context, req Request, doubt func(Response) bool) (Response, bool, error) {
	req.Tier = Cheap
	r, err := c.Complete(ctx, req)
	if err == nil && (doubt == nil || !doubt(r)) {
		return r, false, nil
	}
	req.Tier = Expensive
	r, err = c.Complete(ctx, req)
	return r, true, err
}

// Stats returns a snapshot of the client's meter.
func (c *Client) Stats() Stats { return c.meter().Snapshot() }

func (c *Client) meter() *Meter {
	if c.Meter == nil {
		c.Meter = &Meter{}
	}
	return c.Meter
}

// ---------- OpenRouter wire format (OpenAI-compatible) ----------

type orPart struct {
	Type       string        `json:"type"`
	Text       string        `json:"text,omitempty"`
	ImageURL   *orImageURL   `json:"image_url,omitempty"`
	InputAudio *orInputAudio `json:"input_audio,omitempty"`
}

type orInputAudio struct {
	Data   string `json:"data"` // base64
	Format string `json:"format"`
}

type orImageURL struct {
	URL string `json:"url"`
}

type orMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string or []orPart
}

type orRequest struct {
	Model          string      `json:"model"`
	Messages       []orMessage `json:"messages"`
	MaxTokens      int         `json:"max_tokens"`
	ResponseFormat *struct {
		Type string `json:"type"`
	} `json:"response_format,omitempty"`
}

type orResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int     `json:"prompt_tokens"`
		CompletionTokens int     `json:"completion_tokens"`
		Cost             float64 `json:"cost"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func toOpenRouter(model string, req Request) orRequest {
	out := orRequest{Model: model, MaxTokens: req.MaxTokens}
	if out.MaxTokens == 0 {
		out.MaxTokens = 1024
	}
	if req.JSON {
		out.ResponseFormat = &struct {
			Type string `json:"type"`
		}{Type: "json_object"}
	}
	if req.System != "" {
		out.Messages = append(out.Messages, orMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		if len(m.Images) == 0 && m.Audio == nil {
			out.Messages = append(out.Messages, orMessage{Role: m.Role, Content: m.Text})
			continue
		}
		parts := []orPart{{Type: "text", Text: m.Text}}
		for _, img := range m.Images {
			parts = append(parts, orPart{Type: "image_url", ImageURL: &orImageURL{URL: img}})
		}
		if m.Audio != nil {
			parts = append(parts, orPart{Type: "input_audio", InputAudio: &orInputAudio{
				Data: base64.StdEncoding.EncodeToString(m.Audio.Data), Format: m.Audio.Format,
			}})
		}
		out.Messages = append(out.Messages, orMessage{Role: m.Role, Content: parts})
	}
	return out
}

func (c *Client) call(ctx context.Context, model string, req Request) (Response, error) {
	if c.APIKey == "" {
		return Response{}, ErrNoAPIKey
	}
	body, err := json.Marshal(toOpenRouter(model, req))
	if err != nil {
		return Response{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Response{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return Response{}, fmt.Errorf("llm: %s: %w", model, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return Response{}, fmt.Errorf("llm: %s: reading response: %w", model, err)
	}

	var or orResponse
	_ = json.Unmarshal(data, &or)
	if resp.StatusCode != http.StatusOK || or.Error != nil {
		msg := string(data)
		if or.Error != nil {
			msg = or.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return Response{}, fmt.Errorf("llm: %s: HTTP %d: %s", model, resp.StatusCode, msg)
	}
	if len(or.Choices) == 0 {
		return Response{}, fmt.Errorf("llm: %s: response without choices", model)
	}
	if strings.TrimSpace(or.Choices[0].Message.Content) == "" {
		// Happens with reasoning models that run out of tokens before answering.
		return Response{}, fmt.Errorf("llm: %s: empty answer (max_tokens too low?)", model)
	}
	if or.Model == "" {
		or.Model = model
	}
	return Response{
		Text:             or.Choices[0].Message.Content,
		Model:            or.Model,
		CostUSD:          or.Usage.Cost,
		PromptTokens:     or.Usage.PromptTokens,
		CompletionTokens: or.Usage.CompletionTokens,
	}, nil
}
