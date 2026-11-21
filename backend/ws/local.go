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

// DefaultAddr is where the desktop app's local server listens. A fixed port lets other
// local processes (for example, the Python scanner) know where to connect.
// Override with the LAUZHACK_ADDR environment variable.
const DefaultAddr = "127.0.0.1:8765"

// Local is an HTTP server on the user's machine (127.0.0.1 only).
type Local struct {
	Addr string // actual host:port
	srv  *http.Server
}

// WSURL returns the WebSocket URL, for example ws://127.0.0.1:8765/ws.
func (l *Local) WSURL() string { return "ws://" + l.Addr + "/ws" }

// Listen starts h on addr. If that port is taken, it uses a free port on 127.0.0.1.
func Listen(addr string, h http.Handler) (*Local, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("ws: %s is taken (%v); using a free port", addr, err)
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, fmt.Errorf("ws: no free port: %w", err)
		}
	}
	l := &Local{Addr: ln.Addr().String(), srv: &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}}
	go func() {
		if err := l.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("ws: local server: %v", err)
		}
	}()
	return l, nil
}

// Close stops the server and waits at most 2 s for open connections.
func (l *Local) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := l.srv.Shutdown(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		return l.srv.Close() // Shutdown does not close hijacked WebSocket connections
	}
	return err
}
