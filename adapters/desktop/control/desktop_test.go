package control

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestExecutorBrightness(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "linux"}

	// Within range
	v := 0.50
	did, err := e.Do(Request{Action: "brightness", Value: &v})
	if err != nil || did != "brightness 50 %" {
		t.Errorf("brightness 0.50: got %q, err %v", did, err)
	}

	// Below minimum (0.01) is clamped up to 0.05
	low := 0.01
	did, err = e.Do(Request{Action: "brightness", Value: &low})
	if err != nil || did != "brightness 5 %" {
		t.Errorf("brightness 0.01: got %q, err %v", did, err)
	}

	// Out of range (high, negative, nil)
	high := 1.5
	if _, err := e.Do(Request{Action: "brightness", Value: &high}); err == nil {
		t.Error("expected error for brightness > 1")
	}
	neg := -0.1
	if _, err := e.Do(Request{Action: "brightness", Value: &neg}); err == nil {
		t.Error("expected error for brightness < 0")
	}
	if _, err := e.Do(Request{Action: "brightness"}); err == nil {
		t.Error("expected error for nil brightness")
	}

	want := "brightness 0.50|brightness 0.05"
	if got := strings.Join(d.Calls, "|"); got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
}

func TestExecutorMicMute(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "linux"}
	did, err := e.Do(Request{Action: "mic_mute"})
	if err != nil || did != "microphone toggled" {
		t.Errorf("mic_mute: got %q, err %v", did, err)
	}
	if len(d.Calls) != 1 || d.Calls[0] != "mic toggle" {
		t.Errorf("calls: %v", d.Calls)
	}
}

// Power is off unless allowed: not even a confirmed request suspends the computer (R2).
func TestExecutorPowerOffByDefault(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "linux"}
	for _, action := range []string{"shutdown", "restart", "suspend"} {
		if _, err := e.Do(Request{Action: action, Confirm: true}); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s: expected power to be off, got %v", action, err)
		}
	}
	if len(d.Calls) != 0 {
		t.Errorf("no desktop calls when power is off: %v", d.Calls)
	}
	if New(Options{DryRun: true}).Status.Power {
		t.Error("status must say power is off by default")
	}
}

func TestExecutorPower(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "linux", AllowPower: true}

	// Without confirm: must fail with ErrNeedsConfirm and make no desktop calls
	for _, action := range []string{"shutdown", "restart", "suspend"} {
		if _, err := e.Do(Request{Action: action, Confirm: false}); err != ErrNeedsConfirm {
			t.Errorf("%s without confirm: expected ErrNeedsConfirm, got %v", action, err)
		}
	}
	if len(d.Calls) != 0 {
		t.Errorf("expected 0 calls without confirm, got: %v", d.Calls)
	}

	// With confirm: performs power action
	for _, action := range []string{"shutdown", "restart", "suspend"} {
		did, err := e.Do(Request{Action: action, Confirm: true})
		if err != nil || did != action {
			t.Errorf("%s with confirm: got %q, err %v", action, did, err)
		}
	}
	want := "power shutdown|power restart|power suspend"
	if got := strings.Join(d.Calls, "|"); got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
}

func TestExecutorOpenApp(t *testing.T) {
	d := &DryRun{}
	launchers := []Launcher{
		{ID: "browser", Name: "Web Browser", Open: "https://example.com"},
		{ID: "calc", Name: "Calculator", Windows: []string{"calc.exe"}, Linux: []string{"gnome-calc"}, Mac: []string{"open", "-a", "Calc"}},
	}
	e := &Executor{Desktop: d, GOOS: "linux", Launchers: launchers}

	// Unknown app
	if _, err := e.Do(Request{Action: "open_app", Target: "unknown"}); err == nil {
		t.Error("expected error for unknown app")
	}

	// Known app with default open handler
	did, err := e.Do(Request{Action: "open_app", Target: "browser"})
	if err != nil || did != "opened Web Browser" {
		t.Errorf("open_app browser: got %q, %v", did, err)
	}

	// Known app with OS-specific command (Linux)
	did, err = e.Do(Request{Action: "open_app", Target: "calc"})
	if err != nil || did != "opened Calculator" {
		t.Errorf("open_app calc: got %q, %v", did, err)
	}

	want := "open xdg-open https://example.com|open gnome-calc"
	if got := strings.Join(d.Calls, "|"); got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}

	// Known app with OS-specific command on Windows
	d.Calls = nil
	e.GOOS = "windows"
	_, err = e.Do(Request{Action: "open_app", Target: "calc"})
	if err != nil {
		t.Fatalf("windows calc: %v", err)
	}
	if len(d.Calls) != 1 || d.Calls[0] != "open calc.exe" {
		t.Errorf("windows calls: %v", d.Calls)
	}
}

func TestLoadAndValidateLaunchers(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "apps.json")

	content := `[
		{"id": "valid_app", "name": "Valid App", "open": "https://example.com"},
		{"id": "calc", "name": "Calculator", "linux": ["gnome-calc"], "windows": ["calc.exe"], "mac": ["open", "-a", "Calculator"]}
	]`
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	launchers := LoadLaunchers(path, "linux")
	if len(launchers) != 2 {
		t.Fatalf("expected 2 launchers, got %d", len(launchers))
	}
	if launchers[0].ID != "valid_app" || launchers[0].Name != "Valid App" {
		t.Errorf("launcher 0: %+v", launchers[0])
	}

	// Validation: duplicate ID
	dups := []Launcher{
		{ID: "app1", Name: "App 1", Open: "https://example.com"},
		{ID: "app1", Name: "App 2", Open: "https://example.com"},
	}
	if _, err := ValidateLaunchers(dups, "linux"); err == nil {
		t.Error("expected error for duplicate ID")
	}

	// Validation: invalid characters in ID
	invalidID := []Launcher{
		{ID: "bad ID!", Name: "Bad", Open: "https://example.com"},
	}
	if _, err := ValidateLaunchers(invalidID, "linux"); err == nil {
		t.Error("expected error for invalid ID")
	}

	// Validation: empty name
	emptyName := []Launcher{
		{ID: "app", Name: "", Open: "https://example.com"},
	}
	if _, err := ValidateLaunchers(emptyName, "linux"); err == nil {
		t.Error("expected error for empty name")
	}

	// Validation: no open or system command for target OS
	noCmd := []Launcher{
		{ID: "app", Name: "App", Windows: []string{"calc.exe"}},
	}
	if _, err := ValidateLaunchers(noCmd, "linux"); err == nil {
		t.Error("expected error for missing command on linux")
	}
}

func newTestServer() (*Server, *DryRun) {
	d := &DryRun{}
	launchers := []Launcher{
		{ID: "browser", Name: "Web Browser", Open: "https://example.com"},
	}
	return &Server{
		Exec:   &Executor{Desktop: d, GOOS: "linux", Launchers: launchers},
		Token:  "secret",
		Assets: fstest.MapFS{"index.html": {Data: []byte(`<meta name="gesture-token" content="__GESTURE_TOKEN__">`)}},
		Status: Status{
			Platform:  "linux",
			Launchers: ToLauncherInfos(launchers),
		},
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

func TestServerMouse(t *testing.T) {
	s, d := newTestServer()
	h := s.Handler()

	do := func(token string, body string) int {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8767/api/mouse", strings.NewReader(body))
		if token != "" {
			r.Header.Set("X-Gesture-Token", token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}

	// Missing token -> 401
	if c := do("", `{"action":"click"}`); c != http.StatusUnauthorized {
		t.Errorf("missing token: %d", c)
	}

	// Unknown action -> 422
	if c := do("secret", `{"action":"triple_click"}`); c != http.StatusUnprocessableEntity {
		t.Errorf("unknown mouse action: %d", c)
	}

	// Valid actions -> 204
	for _, act := range []string{"down", "up", "click", "right_click"} {
		if c := do("secret", `{"action":"`+act+`"}`); c != http.StatusNoContent {
			t.Errorf("action %s: got %d", act, c)
		}
	}

	want := "mouse down|mouse up|click|mouse right_click"
	if got := strings.Join(d.Calls, "|"); got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
}

func TestServerStatus(t *testing.T) {
	s, _ := newTestServer()
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "http://127.0.0.1:8767/api/status", nil)
	r.Header.Set("X-Gesture-Token", "secret")
	s.Handler().ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var st Status
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}
	if len(st.Launchers) != 1 || st.Launchers[0].ID != "browser" || st.Launchers[0].Name != "Web Browser" {
		t.Errorf("launchers in status: %+v", st.Launchers)
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

// In-process calls (the desktop app's bindings) reach the same API without HTTP or a token.
func TestServerCallInProcess(t *testing.T) {
	s, d := newTestServer()
	if code, body := s.Call("GET", "/api/status", ""); code != http.StatusOK || !strings.Contains(body, `"platform":"linux"`) {
		t.Errorf("status: %d %s", code, body)
	}
	if code, _ := s.Call("POST", "/api/action", `{"action":"enter"}`); code != http.StatusOK {
		t.Errorf("action: %d", code)
	}
	if code, _ := s.Call("POST", "/api/mouse", `{"action":"click"}`); code != http.StatusNoContent {
		t.Errorf("mouse: %d", code)
	}
	if code, _ := s.Call("POST", "/api/action", `{"action":"shutdown"}`); code == http.StatusOK {
		t.Error("power still needs the confirmation in-process")
	}
	if code, _ := s.Call("GET", "/", ""); code != http.StatusNotFound {
		t.Errorf("only /api/ is reachable: %d", code)
	}
	if got := strings.Join(d.Calls, "|"); got != "keys enter|click" {
		t.Errorf("calls: %s", got)
	}
}

func TestNewDryRun(t *testing.T) {
	s := New(Options{DryRun: true})
	if !s.Status.DryRun || s.Status.Desktop != "dry run" || s.Exec == nil {
		t.Errorf("got %+v", s.Status)
	}
}

func TestScrollAndKeyboard(t *testing.T) {
	d := &DryRun{}
	e := &Executor{Desktop: d, GOOS: "windows"}
	for _, a := range []string{"scroll_up", "scroll_down"} {
		if err := e.Mouse(a); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.Do(Request{Action: "keyboard"}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(d.Calls, "|"); got != "scroll 1|scroll -1|keyboard" {
		t.Errorf("got %s", got)
	}
}

// Without an apps.json there are still apps to open, with a command for each system.
func TestDefaultLaunchers(t *testing.T) {
	for _, goos := range []string{"windows", "darwin"} {
		ls := DefaultLaunchers(goos)
		if len(ls) != 4 {
			t.Fatalf("%s: %d launchers", goos, len(ls))
		}
		if _, err := ValidateLaunchers(ls, goos); err != nil {
			t.Errorf("%s: %v", goos, err)
		}
	}
	if argv, _ := DefaultLaunchers("windows")[0].Argv("windows"); argv[0] != "explorer.exe" {
		t.Errorf("browser on windows: %v", argv)
	}
}

type noCallWindow struct{ DryRun }

func (n *noCallWindow) FocusWindow(CallApp) error { return ErrWindowNotFound }

// Without the call's window, its shortcut is not sent to whatever window is active.
func TestCallActionNeedsTheCallWindow(t *testing.T) {
	d := &noCallWindow{}
	e := &Executor{Desktop: d, GOOS: "windows"}
	if _, err := e.Do(Request{Action: "toggle_mic", App: "meet"}); err == nil || !strings.Contains(err.Error(), "open the call first") {
		t.Fatalf("got %v", err)
	}
	if len(d.Calls) != 0 {
		t.Errorf("no keys may be pressed: %v", d.Calls)
	}
}
