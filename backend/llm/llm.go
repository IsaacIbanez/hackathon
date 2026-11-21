// Package llm es el cliente frugal de modelos (OpenRouter): dos niveles (barato y caro),
// caché en memoria y contador de coste y latencia.
//
// Quién decide cuándo escalar al modelo caro es quien llama (rol B2), con
// CompleteEscalando y su función de duda. Este paquete solo pone el mecanismo.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Tier es el nivel de modelo.
type Tier string

const (
	Barato Tier = "barato"
	Caro   Tier = "caro"
)

// Modelos por defecto (precios de OpenRouter el 2026-11-21, USD por millón de tokens
// de entrada/salida). Los dos aceptan imágenes. Se cambian con LLM_MODELO_BARATO y LLM_MODELO_CARO.
const (
	ModeloBaratoPorDefecto = "anthropic/claude-haiku-5.5"  // 0,10 / 0,50
	ModeloCaroPorDefecto   = "anthropic/claude-sonnet-5.5" // 2 / 10
	URLPorDefecto          = "https://openrouter.ai/api/v1"
)

// Message es un turno de la conversación. Images son URLs o data URLs
// ("data:image/jpeg;base64,...") para los modelos multimodales.
type Message struct {
	Role   string   `json:"role"` // "user" o "assistant"
	Text   string   `json:"text"`
	Images []string `json:"images,omitempty"`
}

// Request es una petición al modelo.
type Request struct {
	Tier      Tier      `json:"tier"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`
	MaxTokens int       `json:"maxTokens,omitempty"` // 0 = 1024
	JSON      bool      `json:"json,omitempty"`      // pide la respuesta como objeto JSON
}

// Response es la respuesta, con lo que ha costado.
type Response struct {
	Text             string        `json:"text"`
	Model            string        `json:"model"`
	Tier             Tier          `json:"tier"`
	CostUSD          float64       `json:"costUsd"` // 0 si viene de la caché
	Latency          time.Duration `json:"-"`
	LatencyMs        int64         `json:"latencyMs"`
	Cached           bool          `json:"cached"`
	PromptTokens     int           `json:"promptTokens"`
	CompletionTokens int           `json:"completionTokens"`
}

// ErrSinClave indica que falta OPENROUTER_API_KEY.
var ErrSinClave = errors.New("llm: falta la variable de entorno OPENROUTER_API_KEY")

// Client habla con OpenRouter (API compatible con OpenAI).
type Client struct {
	BaseURL string
	APIKey  string
	Models  map[Tier]string
	HTTP    *http.Client
	Cache   *Cache // nil = sin caché
	Meter   *Meter // nunca nil si se crea con New
}

// New crea un cliente con caché y contador.
func New(apiKey string) *Client {
	return &Client{
		BaseURL: URLPorDefecto,
		APIKey:  apiKey,
		Models:  map[Tier]string{Barato: ModeloBaratoPorDefecto, Caro: ModeloCaroPorDefecto},
		HTTP:    &http.Client{Timeout: 90 * time.Second},
		Cache:   NewCache(500),
		Meter:   &Meter{},
	}
}

// NewFromEnv lee OPENROUTER_API_KEY y, si existen, LLM_MODELO_BARATO, LLM_MODELO_CARO y OPENROUTER_URL.
func NewFromEnv() (*Client, error) {
	key := os.Getenv("OPENROUTER_API_KEY")
	if key == "" {
		return nil, ErrSinClave
	}
	c := New(key)
	if v := os.Getenv("LLM_MODELO_BARATO"); v != "" {
		c.Models[Barato] = v
	}
	if v := os.Getenv("LLM_MODELO_CARO"); v != "" {
		c.Models[Caro] = v
	}
	if v := os.Getenv("OPENROUTER_URL"); v != "" {
		c.BaseURL = v
	}
	return c, nil
}

// Complete hace una petición. Si la misma petición ya se hizo, responde desde la caché sin coste.
func (c *Client) Complete(ctx context.Context, req Request) (Response, error) {
	if req.Tier == "" {
		req.Tier = Barato
	}
	model, ok := c.Models[req.Tier]
	if !ok {
		return Response{}, fmt.Errorf("llm: nivel desconocido %q", req.Tier)
	}

	key := cacheKey(model, req)
	if c.Cache != nil {
		if r, ok := c.Cache.Get(key); ok {
			r.Cached, r.CostUSD, r.Latency, r.LatencyMs = true, 0, 0, 0
			c.meter().Record(r)
			return r, nil
		}
	}

	inicio := time.Now()
	r, err := c.call(ctx, model, req)
	r.Latency = time.Since(inicio)
	r.LatencyMs = r.Latency.Milliseconds()
	r.Tier = req.Tier
	if err != nil {
		c.meter().RecordError(req.Tier)
		return Response{}, err
	}
	c.meter().Record(r)
	if c.Cache != nil {
		c.Cache.Put(key, r)
	}
	return r, nil
}

// CompleteEscalando prueba primero el modelo barato y, si duda(respuesta) es true,
// repite la petición con el caro. Devuelve la respuesta final y si escaló.
// Si el barato falla, escala también.
func (c *Client) CompleteEscalando(ctx context.Context, req Request, duda func(Response) bool) (Response, bool, error) {
	req.Tier = Barato
	r, err := c.Complete(ctx, req)
	if err == nil && (duda == nil || !duda(r)) {
		return r, false, nil
	}
	req.Tier = Caro
	r, err = c.Complete(ctx, req)
	return r, true, err
}

func (c *Client) meter() *Meter {
	if c.Meter == nil {
		c.Meter = &Meter{}
	}
	return c.Meter
}

// ---------- Formato de OpenRouter (compatible con OpenAI) ----------

type orPart struct {
	Type     string      `json:"type"`
	Text     string      `json:"text,omitempty"`
	ImageURL *orImageURL `json:"image_url,omitempty"`
}

type orImageURL struct {
	URL string `json:"url"`
}

type orMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string o []orPart
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
		if len(m.Images) == 0 {
			out.Messages = append(out.Messages, orMessage{Role: m.Role, Content: m.Text})
			continue
		}
		parts := []orPart{{Type: "text", Text: m.Text}}
		for _, img := range m.Images {
			parts = append(parts, orPart{Type: "image_url", ImageURL: &orImageURL{URL: img}})
		}
		out.Messages = append(out.Messages, orMessage{Role: m.Role, Content: parts})
	}
	return out
}

func (c *Client) call(ctx context.Context, model string, req Request) (Response, error) {
	if c.APIKey == "" {
		return Response{}, ErrSinClave
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
	datos, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return Response{}, fmt.Errorf("llm: %s: leyendo respuesta: %w", model, err)
	}

	var or orResponse
	_ = json.Unmarshal(datos, &or)
	if resp.StatusCode != http.StatusOK || or.Error != nil {
		msg := string(datos)
		if or.Error != nil {
			msg = or.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return Response{}, fmt.Errorf("llm: %s: HTTP %d: %s", model, resp.StatusCode, msg)
	}
	if len(or.Choices) == 0 {
		return Response{}, fmt.Errorf("llm: %s: respuesta sin choices", model)
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
