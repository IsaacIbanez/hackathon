package control

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
)

// tokenPlaceholder is replaced in index.html with the per-run token.
const tokenPlaceholder = "__GESTURE_TOKEN__"

// Status is what GET /api/status returns to the page.
type Status struct {
	Platform  string         `json:"platform"`
	Desktop   string         `json:"desktop"`
	DryRun    bool           `json:"dryRun"`
	Apps      []CallApp      `json:"apps"`
	Launchers []LauncherInfo `json:"launchers"`
	// Power: suspend, restart and shut down are allowed (the page only offers them then).
	Power bool `json:"power"`
}

// Server serves the gesture page and the local API that acts on the computer (standalone program),
// or answers the same API in-process (Call) when the page runs inside the desktop app.
type Server struct {
	Exec   *Executor
	Token  string
	Assets fs.FS // the built page (index.html and assets/)
	Status Status
	// Port the server listens on. Requests must name it in their Host header (empty: any port).
	Port string

	mu      sync.Mutex // OS actions run one at a time
	apiOnce sync.Once
	apiMux  *http.ServeMux
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", s.guard(s.status))
	mux.HandleFunc("POST /api/action", s.guard(s.action))
	mux.HandleFunc("GET /api/mic", s.guard(s.mic))
	mux.HandleFunc("GET /api/level", s.guard(s.level))
	mux.HandleFunc("POST /api/mouse", s.guard(s.mouse))
	mux.HandleFunc("POST /api/pointer", s.guard(s.pointer))
	mux.HandleFunc("GET /", s.page)
	return s.localHostOnly(mux)
}

// api is the API without the HTTP protections, for callers inside this process (Call).
func (s *Server) api() http.Handler {
	s.apiOnce.Do(func() {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/status", s.status)
		mux.HandleFunc("POST /api/action", s.action)
		mux.HandleFunc("GET /api/mic", s.mic)
		mux.HandleFunc("GET /api/level", s.level)
		mux.HandleFunc("POST /api/mouse", s.mouse)
		mux.HandleFunc("POST /api/pointer", s.pointer)
		s.apiMux = mux
	})
	return s.apiMux
}

// Call runs an API request from inside this process — the desktop app's bindings, where the page
// lives in the app's own window — without HTTP, a port or a token. It returns the HTTP status and
// the JSON body, the same as the HTTP API. Only the /api/ routes are reachable.
func (s *Server) Call(method, path, body string) (int, string) {
	if !strings.HasPrefix(path, "/api/") {
		return http.StatusNotFound, `{"error":"not found"}`
	}
	r := httptest.NewRequest(method, "http://in-process"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.api().ServeHTTP(w, r)
	return w.Code, w.Body.String()
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

// mic answers whether the system microphone is muted: {"muted": true|false}.
func (s *Server) mic(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	muted, err := s.Exec.Desktop.MicMuted()
	s.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusNotImplemented, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"muted": muted})
}

// level answers the current volume or brightness: GET /api/level?target=volume → {"value": 0.4}.
func (s *Server) level(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("target")
	if target != "volume" && target != "brightness" {
		writeError(w, http.StatusBadRequest, "target must be volume or brightness")
		return
	}
	s.mu.Lock()
	v, err := s.Exec.Desktop.Level(target)
	s.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusNotImplemented, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]float64{"value": v})
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
	case errors.Is(err, ErrUnknownAction), errors.Is(err, ErrUnknownLauncher):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrNeedsConfirm):
		writeError(w, http.StatusPreconditionRequired, err.Error())
	case errors.Is(err, ErrUnsupported):
		writeError(w, http.StatusNotImplemented, err.Error())
	case err != nil:
		log.Printf("action %q: %v", req.Action, err)
		writeError(w, http.StatusInternalServerError, err.Error())
	default:
		if s.Status.DryRun {
			did = "simulated (dry run): " + did
		}
		log.Printf("did: %s", did)
		writeJSON(w, http.StatusOK, map[string]string{"did": did})
	}
}

func (s *Server) mouse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Action != "down" && req.Action != "up" && req.Action != "click" && req.Action != "right_click" {
		writeError(w, http.StatusUnprocessableEntity, "unknown mouse action")
		return
	}
	s.mu.Lock()
	err := s.Exec.Mouse(req.Action)
	s.mu.Unlock()
	switch {
	case errors.Is(err, ErrUnsupported):
		writeError(w, http.StatusNotImplemented, err.Error())
	case err != nil:
		log.Printf("mouse %q: %v", req.Action, err)
		writeError(w, http.StatusInternalServerError, err.Error())
	default:
		w.WriteHeader(http.StatusNoContent)
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
