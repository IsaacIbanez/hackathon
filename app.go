package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/IsaacIbanez/hackathon/backend/llm"
	"github.com/IsaacIbanez/hackathon/backend/mock"
	"github.com/IsaacIbanez/hackathon/backend/session"
	"github.com/IsaacIbanez/hackathon/backend/ws"
)

// App is the object Wails exposes to the frontend (public methods = bindings).
// Day-to-day communication goes through the contract WebSocket (api/openapi.yaml),
// not through bindings, so the frontend works the same against the mock.
type App struct {
	ctx    context.Context
	server *ws.Local
	hub    *ws.Hub // nil when answering with fixtures
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	h, err := a.newHandler()
	if err != nil {
		log.Printf("app: no WebSocket server: %v", err)
		return
	}
	addr := os.Getenv("LAUZHACK_ADDR")
	if addr == "" {
		addr = ws.DefaultAddr
	}
	a.server, err = ws.Listen(addr, h)
	if err != nil {
		log.Printf("app: no WebSocket server: %v", err)
		return
	}
	log.Printf("app: WebSocket on %s", a.server.WSURL())
}

func (a *App) shutdown(context.Context) {
	if a.server != nil {
		_ = a.server.Close()
	}
	if a.hub != nil {
		a.hub.Close()
	}
}

// WsURL returns the URL of the app's local WebSocket (empty if it did not start).
// The frontend asks for it on startup when running inside Wails.
func (a *App) WsURL() string {
	if a.server == nil {
		return ""
	}
	return a.server.WSURL()
}

// newHandler serves the real sessions when there is an OpenRouter key (environment or
// .env) and falls back to the fixtures (backend/mock) otherwise, so the app always starts.
func (a *App) newHandler() (http.Handler, error) {
	client, err := llm.NewFromEnv()
	if err != nil {
		log.Printf("app: %v; answering with sample fixtures", err)
		return mock.NewMux()
	}
	log.Printf("app: real sessions, cheap=%s expensive=%s", client.Models[llm.Cheap], client.Models[llm.Expensive])
	h, hub := session.NewMux(client, session.DefaultConfig())
	a.hub = hub
	return h, nil
}

// ReportDiagnostics lets the UI write what the embedded browser supports (speech synthesis,
// Spanish voices, speech recognition, camera) to the app log (lauzhack.log).
func (a *App) ReportDiagnostics(report string) {
	if len(report) > 2000 {
		report = report[:2000]
	}
	log.Printf("ui diagnostics: %s", report)
}
