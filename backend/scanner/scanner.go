// Package scanner is the client of the document reading service (role B2, Python,
// scanner/): POST a camera photo, get back the contract's DocumentPayload with pageCorners.
package scanner

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

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// DefaultURL is where the reading service listens. Override with SCANNER_URL.
const DefaultURL = "http://127.0.0.1:8770/scan"

var (
	// ErrNoPage means the service found no page in the photo (it answered 422).
	ErrNoPage = errors.New("scanner: no page found in the photo")
	// ErrUnavailable means the service is not running or did not answer.
	ErrUnavailable = errors.New("scanner: reading service not available")
)

// Client talks to the reading service.
type Client struct {
	URL  string
	HTTP *http.Client
}

// FromEnv returns the scanner configured by SCANNER_URL: "fixture" answers with the sample
// form (no reading service needed); anything else is the service's URL (default DefaultURL).
func FromEnv() interface {
	Scan(ctx context.Context, photo []byte, contentType string) (gen.DocumentPayload, error)
} {
	if os.Getenv("SCANNER_URL") == "fixture" {
		return Fixture{}
	}
	return New()
}

// New returns a client for SCANNER_URL (or DefaultURL). OCR of a 4K page takes ~8 s.
func New() *Client {
	url := os.Getenv("SCANNER_URL")
	if url == "" {
		url = DefaultURL
	}
	return &Client{URL: url, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

// Scan sends the photo and returns the document read from it.
func (c *Client) Scan(ctx context.Context, photo []byte, contentType string) (gen.DocumentPayload, error) {
	var doc gen.DocumentPayload
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(photo))
	if err != nil {
		return doc, err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return doc, ctx.Err()
		}
		return doc, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return doc, fmt.Errorf("%w: reading the answer: %v", ErrUnavailable, err)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, &doc); err != nil {
			return doc, fmt.Errorf("scanner: answer is not a DocumentPayload: %w", err)
		}
		return doc, nil
	case http.StatusUnprocessableEntity:
		return doc, fmt.Errorf("%w: %s", ErrNoPage, short(body))
	default:
		return doc, fmt.Errorf("scanner: HTTP %d: %s", resp.StatusCode, short(body))
	}
}

func short(b []byte) string {
	if len(b) > 200 {
		return string(b[:200]) + "…"
	}
	return string(b)
}
