package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/scanner"
)

// PDF Scanner with a preview (Didac, docs/briefs/scan-preview.md): the photo gives the document and
// the scan's id; the app then shows the scan's PDF in the PDF viewer (N4, read aloud on demand) and
// makes the digital PDF only when the person asks (paid vision model, off by default since R3).

// ScannedPaper is a camera photo read by the reading service. ScanID is empty when there is no PDF
// to show (SCANNER_URL=fixture): the app then shows the lines.
type ScannedPaper struct {
	ScanID   string              `json:"scanId"`
	Document gen.DocumentPayload `json:"document"`
}

// ScanPaper reads a camera photo, like ReadPhoto, and also returns the scan's id (ScannedPaper as JSON).
func (a *App) ScanPaper(photo string) (string, error) {
	sc, ok := scanner.FromEnv().(*scanner.Client)
	if !ok { // the fixture: no reading service, no PDF
		doc, err := a.readPhoto(photo)
		if err != nil {
			return "", err
		}
		return toJSON(ScannedPaper{Document: doc}), nil
	}
	data, ct, err := decodeDataURL(photo)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	if err := a.overlay.reading.Ensure(ctx); err != nil {
		return "", err
	}
	start := time.Now()
	doc, id, err := sc.ScanWithID(ctx, data, ct)
	log.Printf("scan: %d lines, id %q, in %s (err=%v)", len(doc.Blocks), id, time.Since(start).Round(time.Millisecond), err)
	if err != nil {
		return "", noPageError(err)
	}
	return toJSON(ScannedPaper{ScanID: id, Document: doc}), nil
}

// noPageError gives the UI the same "no_page:" prefix as ReadPhoto, so it can say how to hold the paper.
func noPageError(err error) error {
	if errors.Is(err, scanner.ErrNoPage) {
		return errors.New("no_page: I can't find the sheet. Hold it flat and whole in front of the camera")
	}
	return err
}

// ScanPDF waits for a scan's PDF (kind "searchable" or "digital") and opens it for the PDF viewer
// (PDFInfo as JSON; its pages come from PDFPage).
func (a *App) ScanPDF(scanID, kind string) (string, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 75*time.Second)
	defer cancel()
	start := time.Now()
	info, err := scanner.New().ScanPDF(ctx, scanID, kind)
	log.Printf("scan: %s PDF of %s in %s (err=%v)", kind, scanID, time.Since(start).Round(time.Millisecond), err)
	if err != nil {
		return "", err
	}
	return toJSON(info), nil
}

// MakeDigitalPDF makes the digital PDF of a scan and opens it (PDFInfo as JSON). It can take ~30 s.
func (a *App) MakeDigitalPDF(scanID string) (string, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 160*time.Second)
	defer cancel()
	start := time.Now()
	info, err := scanner.New().MakeDigitalPDF(ctx, scanID)
	log.Printf("scan: digital PDF of %s in %s (err=%v)", scanID, time.Since(start).Round(time.Millisecond), err)
	if err != nil {
		return "", err
	}
	return toJSON(info), nil
}
