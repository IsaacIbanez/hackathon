package ws

import (
	"io"
	"net/http"
	"testing"
)

func TestEscucharUsaOtroPuertoSiEstaOcupado(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") })

	a, err := Escuchar("127.0.0.1:0", h)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Cerrar()

	b, err := Escuchar(a.Addr, h) // mismo puerto: ocupado
	if err != nil {
		t.Fatal(err)
	}
	defer b.Cerrar()
	if b.Addr == a.Addr {
		t.Fatalf("debería haber usado otro puerto, los dos en %s", a.Addr)
	}

	resp, err := http.Get("http://" + b.Addr + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if cuerpo, _ := io.ReadAll(resp.Body); string(cuerpo) != "ok" {
		t.Fatalf("respuesta: %q", cuerpo)
	}
	if b.WSURL() != "ws://"+b.Addr+"/ws" {
		t.Fatalf("WSURL: %s", b.WSURL())
	}
}
