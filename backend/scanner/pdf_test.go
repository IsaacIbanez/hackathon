package scanner

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPDFPages(t *testing.T) {
	var opened string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/pdf":
			b, _ := io.ReadAll(r.Body)
			opened = r.URL.Query().Get("name") + ":" + string(b)
			_, _ = w.Write([]byte(`{"id":"ab12","name":"carta.pdf","pages":40,"lang":"es-ES"}`))
		case r.URL.Path == "/pdf/ab12/page/3/lines":
			_, _ = w.Write([]byte(`{"page":3,"ocr":true,"lines":[{"id":"p4-l1","text":"Artículo 10","box":{"x":0.1,"y":0.2,"w":0.5,"h":0.02},"confidence":0.9}]}`))
		case r.URL.Path == "/pdf/ab12/page/3.jpg" && r.URL.Query().Get("width") == "800":
			_, _ = w.Write([]byte{0xff, 0xd8, 0xff})
		default:
			http.Error(w, `{"error":"page_not_found"}`, http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := &Client{URL: srv.URL + "/scan", HTTP: srv.Client()}

	info, err := c.OpenPDF(context.Background(), `C:\docs\carta.pdf`, []byte("%PDF-1.7"))
	if err != nil || info.ID != "ab12" || info.Pages != 40 || opened != "carta.pdf:%PDF-1.7" {
		t.Fatalf("open: %+v %v %q", info, err, opened)
	}
	p, err := c.PDFPage(context.Background(), "ab12", 3, 800)
	if err != nil || !p.OCR || len(p.Lines) != 1 || p.Lines[0].Text != "Artículo 10" || p.Image != "data:image/jpeg;base64,/9j/" {
		t.Fatalf("page: %+v %v", p, err)
	}
	if _, err := c.PDFPage(context.Background(), "ab12", 9, 800); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("missing page: %v", err)
	}
}
