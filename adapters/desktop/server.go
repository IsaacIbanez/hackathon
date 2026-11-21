package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
)

// tokenPlaceholder is replaced in index.html with the per-run token.
const tokenPlaceholder = "__GESTURE_TOKEN__"

// Status is what GET /api/status returns to the page.
type Status struct {
	Platform string    `json:"platform"`
	Desktop  string    `json:"desktop"`
	DryRun   bool      `json:"dryRun"`
	Apps     []CallApp `json:"apps"`
}

// Server serves the gesture page and the local API that acts on the computer.
type Server struct {
	Exec   *Executor
	Token  string
	Assets fs.FS // the built page (index.html and assets/)
	Status Status
	// Port the server listens on. Requests must name it in their Host header (empty: any port).
	Port string

	mu sync.Mutex // OS actions run one at a time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", s.guard(s.status))
	mux.HandleFunc("POST /api/action", s.guard(s.action))
	mux.HandleFunc("POST /api/pointer", s.guard(s.pointer))
	mux.HandleFunc("GET /", s.page)
	return s.localHostOnly(mux)
}

// localHostOnly rejects every request (the page too) whose Host header isn't this computer.
// Without it, DNS rebinding would work: a website points its own domain at 127.0.0.1, loads the
// page (reading the token in it) and passes the origin check, since Origin then equals
// "http://" + its domain.
func (s *Server) localHostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.allowedHost(r.Host) {
			writeError(w, http.StatusForbidden, "host not allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) allowedHost(hostport string) bool {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return false
	}
	if s.Port != "" && port != s.Port {
		return false
	}
	switch strings.ToLower(host) {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	return false
}

// guard only lets the page we served call the API: it needs the per-run token, and requests from
// another origin are rejected. Without this, any website could make the computer press keys.
func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			writeError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		if r.Header.Get("X-Gesture-Token") != s.Token {
			writeError(w, http.StatusUnauthorized, "missing or wrong token")
			return
		}
		next(w, r)
	}
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Status)
}

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	var req Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	s.mu.Lock()
	did, err := s.Exec.Do(req)
	s.mu.Unlock()
	switch {
	case errors.Is(err, ErrUnknownAction):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrUnsupported):
		writeError(w, http.StatusNotImplemented, err.Error())
	case err != nil:
		log.Printf("action %q: %v", req.Action, err)
		writeError(w, http.StatusInternalServerError, err.Error())
	default:
		log.Printf("did: %s", did)
		writeJSON(w, http.StatusOK, map[string]string{"did": did})
	}
}

func (s *Server) pointer(w http.ResponseWriter, r *http.Request) {
	var p struct{ X, Y float64 }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	s.mu.Lock()
	err := s.Exec.MovePointer(p.X, p.Y)
	s.mu.Unlock()
	switch {
	case errors.Is(err, ErrUnsupported):
		writeError(w, http.StatusNotImplemented, err.Error())
	case err != nil:
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// page serves index.html (with the token) and the built assets.
func (s *Server) page(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	if path != "index.html" {
		http.FileServerFS(s.Assets).ServeHTTP(w, r)
		return
	}
	html, err := fs.ReadFile(s.Assets, "index.html")
	if err != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("The gesture page is not built yet. See adapters/desktop/README.md (npm run build step).\n"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(strings.ReplaceAll(string(html), tokenPlaceholder, s.Token)))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
