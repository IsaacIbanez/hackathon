package ws

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

// DireccionPorDefecto es donde escucha el servidor local de la app de escritorio.
// Un puerto fijo permite que otros procesos locales (por ejemplo, un adaptador en Python)
// sepan dónde conectarse. Se cambia con la variable de entorno LAUZHACK_ADDR.
const DireccionPorDefecto = "127.0.0.1:8765"

// Local es un servidor HTTP en la máquina del usuario (solo 127.0.0.1).
type Local struct {
	Addr string // host:puerto real
	srv  *http.Server
}

// WSURL devuelve la URL del WebSocket, por ejemplo ws://127.0.0.1:8765/ws.
func (l *Local) WSURL() string { return "ws://" + l.Addr + "/ws" }

// Escuchar arranca h en addr. Si ese puerto está ocupado, usa uno libre de 127.0.0.1.
func Escuchar(addr string, h http.Handler) (*Local, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("ws: %s ocupado (%v); uso un puerto libre", addr, err)
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, fmt.Errorf("ws: no hay puerto libre: %w", err)
		}
	}
	l := &Local{Addr: ln.Addr().String(), srv: &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}}
	go func() {
		if err := l.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("ws: servidor local: %v", err)
		}
	}()
	return l, nil
}

// Cerrar para el servidor y espera como mucho 2 s a las conexiones abiertas.
func (l *Local) Cerrar() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := l.srv.Shutdown(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		return l.srv.Close() // los WebSocket no se cierran solos con Shutdown
	}
	return err
}
