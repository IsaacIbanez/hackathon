package scanner

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScanReturnsTheDocument(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if r.Header.Get("Content-Type") != "image/png" || string(body) != "PHOTO" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"blocks":[{"id":"b1","text":"Hola","box":{"x":0.1,"y":0.1,"w":0.5,"h":0.05},"confidence":0.9}],
			"quality":{"score":0.8,"issues":[]},"pageCorners":[{"x":0.3,"y":0.1},{"x":0.7,"y":0.1},{"x":0.7,"y":0.9},{"x":0.3,"y":0.9}]}`))
	}))
	defer srv.Close()

	doc, err := (&Client{URL: srv.URL, HTTP: srv.Client()}).Scan(context.Background(), []byte("PHOTO"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Blocks) != 1 || doc.PageCorners == nil || len(*doc.PageCorners) != 4 || (*doc.PageCorners)[2].X != 0.7 {
		t.Fatalf("doc: %+v", doc)
	}
}

func TestScanErrors(t *testing.T) {
	noPage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"error":"no page"}`))
	}))
	defer noPage.Close()
	if _, err := (&Client{URL: noPage.URL, HTTP: noPage.Client()}).Scan(context.Background(), []byte("x"), "image/png"); !errors.Is(err, ErrNoPage) {
		t.Fatalf("422 should be ErrNoPage, got %v", err)
	}

	down := httptest.NewServer(http.NotFoundHandler())
	url := down.URL
	down.Close() // nothing listens there any more
	if _, err := (&Client{URL: url, HTTP: http.DefaultClient}).Scan(context.Background(), []byte("x"), "image/png"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("a closed service should be ErrUnavailable, got %v", err)
	}
}

func TestFixtureAndFromEnv(t *testing.T) {
	t.Setenv("SCANNER_URL", "fixture")
	doc, err := FromEnv().Scan(context.Background(), nil, "image/png")
	if err != nil || len(doc.Blocks) == 0 || doc.PageCorners == nil {
		t.Fatalf("fixture scan: %+v %v", doc, err)
	}
	t.Setenv("SCANNER_URL", "")
	if c, ok := FromEnv().(*Client); !ok || c.URL != DefaultURL {
		t.Fatalf("default should be the service at %s", DefaultURL)
	}
}
