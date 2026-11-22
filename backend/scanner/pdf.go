package scanner

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// A PDF read page by page by the reading service (task N4, docs/briefs/N4.md): the viewer shows
// each page and reads it aloud, asking for the next one while the current one sounds.

// PDFInfo is an open PDF in the reading service.
type PDFInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Pages int    `json:"pages"`
	Lang  string `json:"lang"` // BCP-47 guess (es-ES, ca-ES, en-GB) for the voice
}

// PDFLine is a line of a page, with its box normalized to that page.
type PDFLine struct {
	ID         string  `json:"id"`
	Text       string  `json:"text"`
	Box        gen.Box `json:"box"`
	Confidence float32 `json:"confidence"`
}

// PDFPage is one page: its lines in reading order and its image as a data URL.
type PDFPage struct {
	Page  int       `json:"page"` // from 0
	OCR   bool      `json:"ocr"`  // scanned page, read with OCR
	Lines []PDFLine `json:"lines"`
	Image string    `json:"image"` // data:image/jpeg;base64,…
}

func (c *Client) base() string { return strings.TrimSuffix(c.URL, "/scan") }

// OpenPDF sends the PDF to the reading service, which keeps it open to serve its pages.
func (c *Client) OpenPDF(ctx context.Context, name string, data []byte) (PDFInfo, error) {
	var info PDFInfo
	u := c.base() + "/pdf?name=" + url.QueryEscape(filepath.Base(strings.ReplaceAll(name, `\`, "/")))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(data))
	if err != nil {
		return info, err
	}
	req.Header.Set("Content-Type", "application/pdf")
	body, err := c.do(ctx, req)
	if err != nil {
		return info, err
	}
	return info, json.Unmarshal(body, &info)
}

// PDFPage returns a page's lines and its image (width pixels wide).
func (c *Client) PDFPage(ctx context.Context, id string, page, width int) (PDFPage, error) {
	var p PDFPage
	path := fmt.Sprintf("%s/pdf/%s/page/%d", c.base(), url.PathEscape(id), page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, path+"/lines", nil)
	if err != nil {
		return p, err
	}
	body, err := c.do(ctx, req)
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return p, fmt.Errorf("reading service: bad page answer: %w", err)
	}
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s.jpg?width=%d", path, width), nil)
	if err != nil {
		return p, err
	}
	img, err := c.do(ctx, req)
	if err != nil {
		return p, err
	}
	p.Image = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(img)
	return p, nil
}

// do sends a request to the reading service and returns the body of a 200 answer.
func (c *Client) do(ctx context.Context, req *http.Request) ([]byte, error) {
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: reading the answer: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("reading service: HTTP %d: %s", resp.StatusCode, short(body))
	}
	return body, nil
}
