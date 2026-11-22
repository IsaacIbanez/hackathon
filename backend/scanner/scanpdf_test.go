package scanner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScanPDFs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/scan":
			w.Header().Set("X-Scan-Id", "scan-1")
			_, _ = w.Write([]byte(`{"blocks":[],"quality":{"score":1,"issues":[]},"imageWidth":10,"imageHeight":10}`))
		case r.Method == http.MethodGet && r.URL.Path == "/scan/scan-1/pdf" && r.URL.Query().Get("kind") == PDFSearchable:
			_, _ = w.Write([]byte(`{"id":"ab12","name":"scan-1.pdf","pages":1,"lang":"es-ES"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/scan/scan-1/pdf":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"pdf_not_made","message":"This scan has no digital PDF"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/scan/scan-1/digital":
			_, _ = w.Write([]byte(`{"id":"cd34","name":"scan-1-digital.pdf","pages":1,"lang":"es-ES"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"scan_not_found","message":"Unknown or old scan"}`))
		}
	}))
	defer srv.Close()
	c := &Client{URL: srv.URL + "/scan", HTTP: srv.Client()}
	ctx := context.Background()

	if _, id, err := c.ScanWithID(ctx, []byte{0x89}, "image/png"); err != nil || id != "scan-1" {
		t.Fatalf("scan: %q %v", id, err)
	}
	if info, err := c.ScanPDF(ctx, "scan-1", PDFSearchable); err != nil || info.ID != "ab12" || info.Name != "scan-1.pdf" {
		t.Fatalf("searchable: %+v %v", info, err)
	}
	if _, err := c.ScanPDF(ctx, "scan-1", PDFDigital); err == nil || err.Error() != "pdf_not_made: This scan has no digital PDF" {
		t.Fatalf("no digital yet: %v", err)
	}
	if info, err := c.MakeDigitalPDF(ctx, "scan-1"); err != nil || info.ID != "cd34" {
		t.Fatalf("digital: %+v %v", info, err)
	}
	if _, err := c.ScanPDF(ctx, "old", PDFSearchable); err == nil || err.Error() != "scan_not_found: Unknown or old scan" {
		t.Fatalf("unknown scan: %v", err)
	}
}
