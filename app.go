package main

import "context"

// App es el objeto que Wails expone al frontend (métodos públicos = bindings).
// La comunicación del día a día va por el WebSocket del contrato (api/openapi.yaml),
// no por bindings, para que el frontend funcione igual contra el mock.
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}
