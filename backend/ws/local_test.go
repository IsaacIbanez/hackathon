package ws

import (
	"io"
	"net/http"
	"testing"
)

func TestListenUsesAnotherPortWhenTaken(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") })

	a, err := Listen("127.0.0.1:0", h)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	b, err := Listen(a.Addr, h) // same port: taken
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if b.Addr == a.Addr {
		t.Fatalf("should have used another port, both on %s", a.Addr)
	}

	resp, err := http.Get("http://" + b.Addr + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if body, _ := io.ReadAll(resp.Body); string(body) != "ok" {
		t.Fatalf("response: %q", body)
	}
	if b.WSURL() != "ws://"+b.Addr+"/ws" {
		t.Fatalf("WSURL: %s", b.WSURL())
	}
}
