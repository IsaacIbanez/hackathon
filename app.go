package main

import (
	"context"
	"log"
	"os"

	"github.com/IsaacIbanez/hackathon/backend/mock"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

// App es el objeto que Wails expone al frontend (métodos públicos = bindings).
// La comunicación del día a día va por el WebSocket del contrato (api/openapi.yaml),
// no por bindings, para que el frontend funcione igual contra el mock.
type App struct {
	ctx    context.Context
	server *ws.Local
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// De momento la app responde con las fixtures (backend/mock); la lógica real llega con T8.
	h, err := mock.NewMux()
	if err != nil {
		log.Printf("app: sin servidor WebSocket: %v", err)
		return
	}
	addr := os.Getenv("LAUZHACK_ADDR")
	if addr == "" {
		addr = ws.DireccionPorDefecto
	}
	a.server, err = ws.Escuchar(addr, h)
	if err != nil {
		log.Printf("app: sin servidor WebSocket: %v", err)
		return
	}
	log.Printf("app: WebSocket en %s", a.server.WSURL())
}

func (a *App) shutdown(context.Context) {
	if a.server != nil {
		_ = a.server.Cerrar()
	}
}

// WsURL devuelve la URL del WebSocket local de la app (vacía si no arrancó).
// El frontend la pide al arrancar dentro de Wails.
func (a *App) WsURL() string {
	if a.server == nil {
		return ""
	}
	return a.server.WSURL()
}
