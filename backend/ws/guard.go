package ws

import (
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
)

// Guard protects the local HTTP API (which can make the app spend AI budget and speak):
//   - Host must be 127.0.0.1, localhost or [::1] (blocks DNS rebinding: a website whose
//     domain is pointed at 127.0.0.1 sends its own domain as Host);
//   - a request with an Origin header (a browser) must come from one of originPatterns
//     (the app's window, Vite); local processes such as the scanner send no Origin;
//   - for those origins it answers the CORS preflight and adds the CORS headers, so the
//     app's window can POST photos and audio.
//
// originPatterns use the same syntax as the WebSocket (path.Match on the origin's host).
func Guard(next http.Handler, originPatterns []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !localHost(r.Host) {
			http.Error(w, `{"ok":false,"error":"host not allowed"}`, http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			if !originAllowed(origin, r.Host, originPatterns) {
				http.Error(w, `{"ok":false,"error":"origin not allowed"}`, http.StatusForbidden)
				return
			}
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST")
				h.Set("Access-Control-Allow-Headers", "Content-Type")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func localHost(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	host = strings.Trim(host, "[]")
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func originAllowed(origin, requestHost string, patterns []string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if strings.EqualFold(u.Host, requestHost) {
		return true // same origin
	}
	for _, p := range patterns {
		if ok, _ := path.Match(strings.ToLower(p), strings.ToLower(u.Host)); ok {
			return true
		}
	}
	return false
}
