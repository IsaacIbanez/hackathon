package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/IsaacIbanez/hackathon/backend/scanner"
)

// Option 3 with a PDF viewer (task N4, Didac; docs/briefs/N4.md): a PDF is shown page by page and
// read aloud with one button; other files keep the list of lines. The reading service keeps the PDF
// open and serves each page (image and lines) on demand, so there is no page limit.

// maxPDFBytes is the largest PDF the viewer opens (the service accepts up to 200 MB).
const maxPDFBytes = 150 << 20

// pdfPageWidth is the width of the page images, in pixels (sharp enough on a 1080p screen).
const pdfPageWidth = 1100

// OpenedFile is what option 3 opened: a PDF to view page by page, or the lines of another file.
type OpenedFile struct {
	Name      string           `json:"name"`
	Cancelled bool             `json:"cancelled"`
	Kind      string           `json:"kind"` // "pdf" or "lines"
	PDF       *scanner.PDFInfo `json:"pdf,omitempty"`
	Lines     *FileDocument    `json:"lines,omitempty"`
}

// OpenFileForReading asks for a file. A PDF is opened in the reading service for the viewer; any
// other file is read into lines, as before (OpenedFile as JSON).
func (a *App) OpenFileForReading() (string, error) {
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   "Choose a document to read aloud",
		Filters: []wruntime.FileFilter{{DisplayName: "Documents (PDF, text, images)", Pattern: scanner.FilePatterns()}},
	})
	if err != nil || path == "" {
		return toJSON(OpenedFile{Cancelled: true}), err
	}
	res, err := a.openForReading(path)
	if err != nil {
		return "", err
	}
	return toJSON(res), nil
}

func (a *App) openForReading(path string) (OpenedFile, error) {
	name := filepath.Base(path)
	if strings.ToLower(filepath.Ext(path)) != ".pdf" {
		doc, err := a.readFilePath(path)
		return OpenedFile{Name: name, Kind: "lines", Lines: &doc}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return OpenedFile{}, err
	}
	if info.Size() > maxPDFBytes {
		return OpenedFile{}, fmt.Errorf("%s is too big (%d MB, max %d MB)", name, info.Size()>>20, maxPDFBytes>>20)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return OpenedFile{}, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, time.Minute)
	defer cancel()
	if err := a.overlay.reading.Ensure(ctx); err != nil {
		return OpenedFile{}, err
	}
	start := time.Now()
	pdf, err := scanner.New().OpenPDF(ctx, name, data)
	log.Printf("pdf: opened %s: %d pages, %s, in %s (err=%v)", name, pdf.Pages, pdf.Lang, time.Since(start).Round(time.Millisecond), err)
	if err != nil {
		return OpenedFile{}, err
	}
	return OpenedFile{Name: name, Kind: "pdf", PDF: &pdf}, nil
}

// PDFPage returns a page of an open PDF (from 0): its lines and its image (PDFPage as JSON). A
// scanned page goes through OCR and takes a few seconds.
func (a *App) PDFPage(id string, page int) (string, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	start := time.Now()
	p, err := scanner.New().PDFPage(ctx, id, page, pdfPageWidth)
	if err != nil {
		// The service may have been restarted (or the PDF closed): say so, the UI offers to reopen it.
		return "", err
	}
	log.Printf("pdf: page %d: %d lines (ocr=%v) in %s", page+1, len(p.Lines), p.OCR, time.Since(start).Round(time.Millisecond))
	return toJSON(p), nil
}
