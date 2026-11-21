package scanner

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFromText(t *testing.T) {
	long := strings.Repeat("Esta es una frase bastante larga del contrato de seguro. ", 12)
	doc := FromText("\uFEFFTítulo\r\n\r\n  línea   con  espacios \n" + long + "\n")
	if doc.Blocks[0].Text != "Título" || doc.Blocks[1].Text != "línea con espacios" {
		t.Fatalf("first lines: %+v", doc.Blocks[:2])
	}
	if len(doc.Blocks) < 4 {
		t.Fatalf("the long paragraph must be split: %d blocks", len(doc.Blocks))
	}
	prev := float32(-1)
	for _, b := range doc.Blocks {
		if len(b.Text) > maxLine+60 {
			t.Errorf("block too long (%d): %q", len(b.Text), b.Text)
		}
		if b.Box.Y <= prev || b.Box.Y+b.Box.H > 1.0001 || b.Confidence != 1 {
			t.Errorf("bad block %+v", b)
		}
		prev = b.Box.Y
	}
	if empty := FromText(" \n\n"); len(empty.Blocks) != 0 || empty.Blocks == nil {
		t.Errorf("empty text: %+v", empty)
	}
}

func TestReadFile(t *testing.T) {
	var gotPath, gotType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotType = r.URL.String(), r.Header.Get("Content-Type")
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = w.Write([]byte(`{"blocks":[{"id":"p1-l1","text":"Hola","box":{"x":0,"y":0,"w":1,"h":0.1},"confidence":1}],"quality":{"score":1,"issues":[]}}`))
	}))
	defer srv.Close()
	c := &Client{URL: srv.URL + "/scan", HTTP: srv.Client()}

	doc, err := c.ReadFile(context.Background(), `C:\docs\Carta del banco.PDF`, []byte("%PDF-1.7"))
	if err != nil || len(doc.Blocks) != 1 || doc.Blocks[0].Text != "Hola" {
		t.Fatalf("pdf: %+v %v", doc, err)
	}
	if gotPath != "/document?name=Carta+del+banco.PDF" || gotType != "application/pdf" {
		t.Errorf("request: %s %s", gotPath, gotType)
	}

	gotPath = ""
	doc, err = c.ReadFile(context.Background(), "notes.txt", []byte("una\ndos"))
	if err != nil || len(doc.Blocks) != 2 || gotPath != "" {
		t.Fatalf("txt must be read locally: %+v %v %q", doc, err, gotPath)
	}
	if _, err := c.ReadFile(context.Background(), "x.docx", nil); err == nil {
		t.Error("docx is not supported yet: want an error")
	}
}
