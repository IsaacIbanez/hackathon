package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestParseCombo(t *testing.T) {
	c, err := ParseCombo("Ctrl+Shift+M")
	if err != nil || c.String() != "ctrl+shift+m" {
		t.Fatalf("got %v, %v", c, err)
	}
	if c, _ := ParseCombo("cmd+w"); !c.Has("meta") {
		t.Fatalf("cmd should be meta: %v", c)
	}
	for _, bad := range []string{"", "ctrl+", "hyper+a", "ctrl+f13"} {
		if _, err := ParseCombo(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestShortcutsPerPlatformAndApp(t *testing.T) {
	cases := []struct{ action, app, goos, want string }{
		{"toggle_mic", "meet", "linux", "ctrl+d"},
		{"toggle_mic", "meet", "darwin", "meta+d"},
		{"toggle_mic", "", "windows", "ctrl+d"}, // Meet is the default app
		{"toggle_camera", "zoom", "windows", "alt+v"},
		{"raise_hand", "teams", "linux", "ctrl+shift+k"},
		{"undo", "", "darwin", "meta+z"},
		{"undo", "", "linux", "ctrl+z"},
		{"next_tab", "", "linux", "ctrl+tab"},
	}
	for _, c := range cases {
		got, ok := Shortcuts(c.action, c.app, c.goos)
		if !ok || len(got) != 1 || got[0].String() != c.want {
			t.Errorf("%s/%s/%s: got %v, want %s", c.action, c.app, c.goos, got, c.want)
		}
	}
	// Leaving Zoom needs a confirmation.
	if got, _ := Shortcuts("leave_call", "zoom", "windows"); len(got) != 2 || got[1].Key != "enter" {
		t.Errorf("zoom leave: %v", got)
	}
	if _, ok := Shortcuts("read", "", "linux"); ok {
		t.Error("read is not a keyboard action")
	}
	if _, ok := Shortcuts("toggle_mic", "skype", "linux"); ok {
		t.Error("unknown app should fail")
	}
}

func TestExecutor(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "linux"}
	v := 0.6
	steps := []Request{
		{Action: "toggle_mic", App: "teams"},
		{Action: "volume", Value: &v},
		{Action: "click"},
		{Action: "enter"},
	}
	for _, r := range steps {
		if _, err := e.Do(r); err != nil {
			t.Fatalf("%v: %v", r, err)
		}
	}
	want := "focus teams|keys ctrl+shift+m|volume 0.60|click|keys enter"
	if got := strings.Join(d.Calls, "|"); got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
	if _, err := e.Do(Request{Action: "read"}); err == nil {
		t.Error("unknown action should fail")
	}
	bad := 1.5
	if _, err := e.Do(Request{Action: "volume", Value: &bad}); err == nil {
		t.Error("volume out of range should fail")
	}
	if err := e.MovePointer(0.5, 1.2); err == nil {
		t.Error("pointer out of range should fail")
	}
}

func newTestServer() (*Server, *DryRun) {
	d := &DryRun{}
	return &Server{
		Exec:   &Executor{Desktop: d, GOOS: "linux"},
		Token:  "secret",
		Assets: fstest.MapFS{"index.html": {Data: []byte(`<meta name="gesture-token" content="__GESTURE_TOKEN__">`)}},
		Status: Status{Platform: "linux"},
	}, d
}

func TestServerAuth(t *testing.T) {
	s, d := newTestServer()
	h := s.Handler()
	do := func(token, origin, body string) int {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8767/api/action", strings.NewReader(body))
		if token != "" {
			r.Header.Set("X-Gesture-Token", token)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if c := do("", "", `{"action":"enter"}`); c != http.StatusUnauthorized {
		t.Errorf("no token: %d", c)
	}
	if c := do("secret", "https://evil.example", `{"action":"enter"}`); c != http.StatusForbidden {
		t.Errorf("foreign origin: %d", c)
	}
	if c := do("secret", "http://127.0.0.1:8767", `{"action":"enter"}`); c != http.StatusOK {
		t.Errorf("valid request: %d", c)
	}
	if c := do("secret", "", `{"action":"read"}`); c != http.StatusUnprocessableEntity {
		t.Errorf("unknown action: %d", c)
	}
	if len(d.Calls) != 1 || d.Calls[0] != "keys enter" {
		t.Errorf("only the valid request should act: %v", d.Calls)
	}
}

func TestServerInjectsTokenInPage(t *testing.T) {
	s, _ := newTestServer()
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:8767/", nil))
	if !strings.Contains(w.Body.String(), `content="secret"`) {
		t.Errorf("token not injected: %s", w.Body.String())
	}
}

// DNS rebinding: a foreign domain pointed at 127.0.0.1 must not get the page (with the token) nor
// reach the API, even with a matching Origin and the right token.
func TestServerRejectsForeignHost(t *testing.T) {
	s, d := newTestServer()
	s.Port = "8767"
	h := s.Handler()
	do := func(method, url, host, origin string) int {
		var body *strings.Reader
		if method == "POST" {
			body = strings.NewReader(`{"action":"enter"}`)
		} else {
			body = strings.NewReader("")
		}
		r := httptest.NewRequest(method, url, body)
		r.Host = host
		r.Header.Set("X-Gesture-Token", "secret")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for _, host := range []string{"evil.example:8767", "127.0.0.1:9999", "127.0.0.1", "localhost.evil.example:8767"} {
		if c := do("GET", "/", host, ""); c != http.StatusForbidden {
			t.Errorf("page with Host %q: %d", host, c)
		}
		if c := do("POST", "/api/action", host, "http://"+host); c != http.StatusForbidden {
			t.Errorf("action with Host %q: %d", host, c)
		}
	}
	for _, host := range []string{"127.0.0.1:8767", "localhost:8767", "[::1]:8767"} {
		if c := do("GET", "/", host, ""); c != http.StatusOK {
			t.Errorf("page with Host %q: %d", host, c)
		}
	}
	if len(d.Calls) != 0 {
		t.Errorf("no request with a foreign host may act: %v", d.Calls)
	}
}

func TestScreenPixels(t *testing.T) {
	if x, y := screenPixels(1, 0.5, 1920, 1080); x != 1919 || y != 540 {
		t.Errorf("got %d,%d", x, y)
	}
}
