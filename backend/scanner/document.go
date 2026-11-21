package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/IsaacIbanez/hackathon/api/gen"
)

// File types the overlay's "read a file" option accepts, by extension. Text files are read here;
// the rest go to the reading service's POST /document (PDF with or without a text layer, images
// through OCR). To add a type: add it here and, if it is not text, in scanner/service.py.
var FileTypes = map[string]string{
	".txt":  "text/plain",
	".md":   "text/markdown",
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
}

// FilePatterns is the file dialog filter for FileTypes ("*.txt;*.md;…").
func FilePatterns() string {
	var p []string
	for _, ext := range []string{".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg"} {
		p = append(p, "*"+ext)
	}
	return strings.Join(p, ";")
}

// MaxFileBytes is the largest file the overlay reads (same limit as POST /scan).
const MaxFileBytes = 40 << 20

// ReadFile turns a file into the contract's DocumentPayload (lines in reading order).
func (c *Client) ReadFile(ctx context.Context, name string, data []byte) (gen.DocumentPayload, error) {
	ext := strings.ToLower(filepath.Ext(name))
	ct, ok := FileTypes[ext]
	if !ok {
		return gen.DocumentPayload{}, fmt.Errorf("file type %q is not supported yet", ext)
	}
	if strings.HasPrefix(ct, "text/") {
		return FromText(string(data)), nil
	}
	return c.readDocument(ctx, name, ct, data)
}

// readDocument posts the file to the reading service's POST /document.
func (c *Client) readDocument(ctx context.Context, name, contentType string, data []byte) (gen.DocumentPayload, error) {
	var doc gen.DocumentPayload
	endpoint := strings.TrimSuffix(c.URL, "/scan") + "/document?name=" + url.QueryEscape(filepath.Base(name))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
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
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return doc, fmt.Errorf("%w: reading the answer: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return doc, fmt.Errorf("reading service: HTTP %d: %s", resp.StatusCode, short(body))
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return doc, fmt.Errorf("scanner: answer is not a DocumentPayload: %w", err)
	}
	return doc, nil
}

// maxLine is the longest block FromText makes: longer paragraphs are cut at sentence ends, so
// the guided reader highlights a readable piece and each utterance stays short.
const maxLine = 280

// FromText makes a document from plain text: one block per line (empty lines skipped, long
// paragraphs split into sentences), stacked top to bottom.
func FromText(text string) gen.DocumentPayload {
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "�")
	}
	text = strings.TrimPrefix(text, "\uFEFF")
	var lines []string
	for _, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.Join(strings.Fields(raw), " ")
		if line == "" {
			continue
		}
		lines = append(lines, splitLong(line)...)
	}
	doc := gen.DocumentPayload{Blocks: []gen.TextBlock{}, Quality: gen.FrameQuality{Score: 1, Issues: []gen.FrameIssue{}}}
	n := float32(len(lines))
	for i, l := range lines {
		doc.Blocks = append(doc.Blocks, gen.TextBlock{
			Id:         fmt.Sprintf("t%d", i+1),
			Text:       l,
			Box:        gen.Box{X: 0, Y: float32(i) / n, W: 1, H: 1 / n},
			Confidence: 1,
		})
	}
	return doc
}

// splitLong cuts a paragraph after ". ", "? " or "! " so no piece is much longer than maxLine.
func splitLong(s string) []string {
	if len(s) <= maxLine {
		return []string{s}
	}
	var out []string
	start := 0
	for i := 0; i < len(s)-1; i++ {
		if (s[i] == '.' || s[i] == '?' || s[i] == '!') && s[i+1] == ' ' && i+1-start >= maxLine/3 {
			out = append(out, strings.TrimSpace(s[start:i+1]))
			start = i + 2
		}
	}
	if rest := strings.TrimSpace(s[start:]); rest != "" {
		out = append(out, rest)
	}
	return out
}
