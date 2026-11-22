package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// The PDFs of a camera scan (PDF Scanner, docs/briefs/scan-preview.md). The reading service answers
// POST /scan as soon as the OCR is done and finishes the searchable PDF in the background; the app then
// shows that PDF in the PDF viewer (N4) and reads it only when the person asks. The digital PDF uses a
// paid vision model, so it is made only on request (MakeDigitalPDF).

// PDF kinds of a scan.
const (
	PDFSearchable = "searchable"
	PDFDigital    = "digital"
)

// digitalTimeout covers the OCR again plus the vision model (cheap, then expensive if they disagree).
const digitalTimeout = 150 * time.Second

// ScanPDF waits for a scan's PDF (kind PDFSearchable or PDFDigital) and opens it in the reading
// service, like OpenPDF: its pages are then read with PDFPage.
func (c *Client) ScanPDF(ctx context.Context, scanID, kind string) (PDFInfo, error) {
	u := fmt.Sprintf("%s/scan/%s/pdf?kind=%s", c.base(), url.PathEscape(scanID), url.QueryEscape(kind))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return PDFInfo{}, err
	}
	return c.pdfInfo(ctx, c.HTTP, req)
}

// MakeDigitalPDF makes the digital PDF of a scan (it can take ~30 s and calls the paid vision model
// if the reading service has a key; otherwise its local OCR) and opens it.
func (c *Client) MakeDigitalPDF(ctx context.Context, scanID string) (PDFInfo, error) {
	u := fmt.Sprintf("%s/scan/%s/digital", c.base(), url.PathEscape(scanID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, nil)
	if err != nil {
		return PDFInfo{}, err
	}
	slow := *c.HTTP
	slow.Timeout = digitalTimeout
	return c.pdfInfo(ctx, &slow, req)
}

// pdfInfo sends req and decodes a PDFInfo; other answers become "<code>: <message>" errors.
func (c *Client) pdfInfo(ctx context.Context, h *http.Client, req *http.Request) (PDFInfo, error) {
	var info PDFInfo
	resp, err := h.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return info, ctx.Err()
		}
		return info, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return info, fmt.Errorf("%w: reading the answer: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		var e struct{ Error, Message string }
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return info, fmt.Errorf("%s: %s", e.Error, e.Message)
		}
		return info, fmt.Errorf("reading service: HTTP %d: %s", resp.StatusCode, short(body))
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return info, fmt.Errorf("reading service: bad PDF answer: %w", err)
	}
	return info, nil
}
