package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/IsaacIbanez/hackathon/adapters/desktop/control"
	"github.com/IsaacIbanez/hackathon/api/gen"
	"github.com/IsaacIbanez/hackathon/backend/overlay"
	"github.com/IsaacIbanez/hackathon/backend/scanner"
)

// Bindings that return structures return them as JSON text: Wails would otherwise generate
// wailsjs/go/models.ts with TypeScript namespaces, which the frontend's tsconfig rejects
// (erasableSyntaxOnly). The frontend parses them (web/src/app/overlay/desktop.ts).
//
// Overlay: the app lives in a small always-on-top window that a system-wide shortcut
// (Ctrl+Alt+Space, or an MX Keypad key mapped to it) shows and hides. It offers the team's
// features as options; see docs/OVERLAY.md. These are the bindings the overlay UI calls.

type overlayState struct {
	mu       sync.Mutex
	visible  bool
	hotkey   string
	hotkeyOK bool
	stopKey  func()
	reading  *overlay.ReadingService
	// Gesture Control (role C) runs inside this app: its camera page is option 1 and its actions
	// go through GestureCall, with no separate program, port or token.
	gestures   *control.Server
	gesturesOn bool // option 1 is showing the camera
	compact    bool // shrunk to a camera bubble in a corner instead of hidden
	screen     bool // from the bubble: see-through over the whole screen while the gesture menu is open
}

// startOverlay registers the shortcut; the window starts visible so the person sees it once.
func (a *App) startOverlay(ctx context.Context) {
	o := &a.overlay
	o.visible = true
	o.reading = overlay.NewReadingService()
	o.gestures = newGestureControl()
	h, err := overlay.HotkeyFromEnv()
	if err != nil {
		log.Printf("overlay: %v; using %s", err, overlay.DefaultHotkey)
		h, _ = overlay.ParseHotkey(overlay.DefaultHotkey)
	}
	o.hotkey = h.String()
	stop, err := overlay.Listen(h, func() { a.toggleOverlay(ctx) })
	if err != nil {
		log.Printf("overlay: %v (the window stays open)", err)
		o.stopKey = func() {}
		return
	}
	o.stopKey, o.hotkeyOK = stop, true
	log.Printf("overlay: press %s to show or hide the overlay", h)
}

func (a *App) stopOverlay() {
	o := &a.overlay
	if o.stopKey != nil {
		o.stopKey()
	}
	if o.reading != nil {
		o.reading.Stop() // only if this app started it
	}
}

func (a *App) toggleOverlay(ctx context.Context) {
	o := &a.overlay
	o.mu.Lock()
	if o.gesturesOn {
		// With the gestures on, the window is never hidden (a hidden page would pause the camera):
		// the shortcut switches between the full overlay and the camera bubble.
		compact := !o.compact
		o.mu.Unlock()
		a.setCompact(ctx, compact)
		return
	}
	// Open but covered by another window: bring it to the front instead of hiding it.
	show := !o.visible || !overlay.ForegroundIsOurs()
	o.visible = show
	o.mu.Unlock()
	if show {
		wruntime.WindowShow(ctx)
		wruntime.WindowUnminimise(ctx)
		wruntime.WindowCenter(ctx)
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		wruntime.EventsEmit(ctx, "overlay:shown")
	} else {
		wruntime.EventsEmit(ctx, "overlay:hidden")
		wruntime.WindowHide(ctx)
	}
}

// OverlayInfo tells the UI how the overlay is opened.
type OverlayInfo struct {
	Hotkey   string `json:"hotkey"`
	HotkeyOK bool   `json:"hotkeyOk"` // false: another program owns the shortcut (or not Windows)
}

// OverlayInfo returns OverlayInfo as JSON.
func (a *App) OverlayInfo() string {
	return toJSON(OverlayInfo{Hotkey: a.overlay.hotkey, HotkeyOK: a.overlay.hotkeyOK})
}

func toJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// HideOverlay hides the window (the shortcut shows it again). Without a working shortcut it only
// minimises, so the window can't get lost.
func (a *App) HideOverlay() {
	o := &a.overlay
	o.mu.Lock()
	gestures := o.gesturesOn
	o.mu.Unlock()
	if gestures {
		a.setCompact(a.ctx, true)
		return
	}
	if !o.hotkeyOK {
		wruntime.WindowMinimise(a.ctx)
		return
	}
	o.mu.Lock()
	o.visible = false
	o.mu.Unlock()
	wruntime.EventsEmit(a.ctx, "overlay:hidden")
	wruntime.WindowHide(a.ctx)
}

// Quit closes the app (and the helper processes it started).
func (a *App) Quit() { wruntime.Quit(a.ctx) }

// ---- Option "Documents" (Didac and Pau): camera photo → reading service → document ----

// EnsureReadingService starts the reading service if needed; "" when it answers, else the problem.
func (a *App) EnsureReadingService() string {
	ctx, cancel := context.WithTimeout(a.ctx, 40*time.Second)
	defer cancel()
	if err := a.overlay.reading.Ensure(ctx); err != nil {
		log.Printf("overlay: %v", err)
		return err.Error()
	}
	return ""
}

// ReadPhoto reads a camera photo (base64 PNG or JPEG, with or without the data: prefix) and returns
// the DocumentPayload as JSON.
func (a *App) ReadPhoto(photo string) (string, error) {
	doc, err := a.readPhoto(photo)
	if err != nil {
		return "", err
	}
	return toJSON(doc), nil
}

func (a *App) readPhoto(photo string) (gen.DocumentPayload, error) {
	data, ct, err := decodeDataURL(photo)
	if err != nil {
		return gen.DocumentPayload{}, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	sc := scanner.FromEnv()
	if _, real := sc.(*scanner.Client); real {
		if err := a.overlay.reading.Ensure(ctx); err != nil {
			return gen.DocumentPayload{}, err
		}
	}
	doc, err := sc.Scan(ctx, data, ct)
	if errors.Is(err, scanner.ErrNoPage) {
		return doc, errors.New("no_page: I can't find the sheet. Hold it flat and whole in front of the camera")
	}
	return doc, err
}

func decodeDataURL(s string) ([]byte, string, error) {
	ct := "image/png"
	if strings.HasPrefix(s, "data:") {
		meta, rest, ok := strings.Cut(s, ",")
		if !ok {
			return nil, "", errors.New("photo: bad data URL")
		}
		ct = strings.TrimSuffix(strings.TrimPrefix(meta, "data:"), ";base64")
		s = rest
	}
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, "", fmt.Errorf("photo: %w", err)
	}
	return data, ct, nil
}

// ---- Option "Read a file" (Didac): a document from the computer, read aloud ----

// FileDocument is a file read into the contract's document (Cancelled: the dialog was closed).
type FileDocument struct {
	Name      string              `json:"name"`
	Cancelled bool                `json:"cancelled"`
	Document  gen.DocumentPayload `json:"document"`
}

// OpenAndReadFile asks for a file (PDF, text or image) and returns its lines in reading order
// (FileDocument as JSON).
func (a *App) OpenAndReadFile() (string, error) {
	res, err := a.openAndReadFile()
	if err != nil {
		return "", err
	}
	return toJSON(res), nil
}

func (a *App) openAndReadFile() (FileDocument, error) {
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   "Choose a document to read aloud",
		Filters: []wruntime.FileFilter{{DisplayName: "Documents (PDF, text, images)", Pattern: scanner.FilePatterns()}},
	})
	if err != nil || path == "" {
		return FileDocument{Cancelled: true}, err
	}
	return a.readFilePath(path)
}

// readFilePath reads a given file (also for tests and, later, drag and drop).
func (a *App) readFilePath(path string) (FileDocument, error) {
	res := FileDocument{Name: filepath.Base(path)}
	info, err := os.Stat(path)
	if err != nil {
		return res, err
	}
	if info.Size() > scanner.MaxFileBytes {
		return res, fmt.Errorf("%s is too big (%d MB, max %d MB)", res.Name, info.Size()>>20, scanner.MaxFileBytes>>20)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return res, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 3*time.Minute)
	defer cancel()
	ext := strings.ToLower(filepath.Ext(path))
	if ct := scanner.FileTypes[ext]; ct != "" && !strings.HasPrefix(ct, "text/") {
		if err := a.overlay.reading.Ensure(ctx); err != nil {
			return res, err
		}
	}
	start := time.Now()
	res.Document, err = scanner.New().ReadFile(ctx, path, data)
	log.Printf("overlay: read %s: %d lines in %s (err=%v)", res.Name, len(res.Document.Blocks), time.Since(start).Round(time.Millisecond), err)
	return res, err
}

// ---- Option "Gestures" (Nil, role C): Gesture Control inside the app ----

// newGestureControl builds Gesture Control. LAUZHACK_GESTURES_DRY_RUN=1 only logs the actions;
// LAUZHACK_SCREEN=1920x1080 gives the screen size where it can't be detected (Linux Wayland);
// LAUZHACK_APPS points to the apps.json of the "Apps" menu.
func newGestureControl() *control.Server {
	w, h := 0, 0
	if s := os.Getenv("LAUZHACK_SCREEN"); s != "" {
		if _, err := fmt.Sscanf(strings.ToLower(s), "%dx%d", &w, &h); err != nil {
			log.Printf("overlay: ignoring LAUZHACK_SCREEN=%q (expected WIDTHxHEIGHT)", s)
			w, h = 0, 0
		}
	}
	dry := os.Getenv("LAUZHACK_GESTURES_DRY_RUN") == "1"
	g := control.New(control.Options{DryRun: dry, Width: w, Height: h, Apps: os.Getenv("LAUZHACK_APPS")})
	log.Printf("overlay: gestures act through %s", g.Status.Desktop)
	return g
}

// GestureCall is Gesture Control's API (GET /api/status, POST /api/action, /api/mouse,
// /api/pointer) for the camera page inside this window. It returns {"status": …, "body": …} as JSON.
func (a *App) GestureCall(method, path, body string) string {
	code, out := a.overlay.gestures.Call(method, path, body)
	return toJSON(struct {
		Status int    `json:"status"`
		Body   string `json:"body"`
	}{code, out})
}

// SetGesturesActive tells Go that option 1 is using the camera (true) or has stopped (false).
// While it is on, hiding the overlay shrinks it to a camera bubble instead.
func (a *App) SetGesturesActive(on bool) {
	o := &a.overlay
	o.mu.Lock()
	o.gesturesOn = on
	compact := o.compact
	o.mu.Unlock()
	if !on && compact {
		a.setCompact(a.ctx, false)
	}
}

// SetCompact shrinks the window to a small camera bubble in the bottom-right corner (true), or
// brings back the full overlay (false).
func (a *App) SetCompact(on bool) { a.setCompact(a.ctx, on) }

const (
	compactWidth  = 360
	compactHeight = 240
	compactMargin = 24
)

func (a *App) setCompact(ctx context.Context, on bool) {
	o := &a.overlay
	o.mu.Lock()
	o.compact = on
	o.visible = true
	wasScreen := o.screen
	o.screen = false
	o.mu.Unlock()
	if wasScreen {
		wruntime.WindowUnfullscreen(ctx)
	}
	wruntime.WindowShow(ctx)
	wruntime.WindowUnminimise(ctx)
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	if on {
		wruntime.WindowSetSize(ctx, compactWidth, compactHeight)
		if sw, sh := currentScreen(ctx); sw > 0 {
			// Above the taskbar, in the corner.
			wruntime.WindowSetPosition(ctx, sw-compactWidth-compactMargin, sh-compactHeight-3*compactMargin)
		}
		wruntime.EventsEmit(ctx, "overlay:compact")
		return
	}
	wruntime.WindowSetSize(ctx, overlayWidth, overlayHeight)
	wruntime.WindowCenter(ctx)
	wruntime.EventsEmit(ctx, "overlay:expanded")
	wruntime.EventsEmit(ctx, "overlay:shown")
}

func currentScreen(ctx context.Context) (int, int) {
	screens, err := wruntime.ScreenGetAll(ctx)
	if err != nil {
		return 0, 0
	}
	for _, s := range screens {
		if s.IsCurrent {
			return s.Size.Width, s.Size.Height
		}
	}
	for _, s := range screens {
		if s.IsPrimary {
			return s.Size.Width, s.Size.Height
		}
	}
	return 0, 0
}

// Size of the full overlay window.
const (
	overlayWidth  = 960
	overlayHeight = 680
)

// keepCameraRunning asks WebView2 not to slow the page down when the window is covered by other
// windows (a video call, for example): the gestures follow the hand from the camera there. Only
// if nobody set these arguments already.
func keepCameraRunning() {
	const env = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
	if os.Getenv(env) != "" {
		return
	}
	_ = os.Setenv(env, "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
}

// SetScreenOverlay, from the camera bubble, spreads the window over the whole screen with a
// see-through page (true): the gesture menu and the volume/brightness control show on top of what
// is open, with the camera small in a corner. false goes back to the bubble. The window covers the
// screen only while the menu or the level control is in use — when the mouse is not needed — so it
// never takes the clicks meant for other programs. Ignored unless the window is the bubble.
func (a *App) SetScreenOverlay(on bool) {
	o := &a.overlay
	o.mu.Lock()
	if !o.compact || o.screen == on {
		o.mu.Unlock()
		return
	}
	o.screen = on
	o.mu.Unlock()
	ctx := a.ctx
	if on {
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		wruntime.WindowFullscreen(ctx)
		wruntime.EventsEmit(ctx, "overlay:screen")
		return
	}
	wruntime.WindowUnfullscreen(ctx)
	wruntime.WindowSetSize(ctx, compactWidth, compactHeight)
	if sw, sh := currentScreen(ctx); sw > 0 {
		wruntime.WindowSetPosition(ctx, sw-compactWidth-compactMargin, sh-compactHeight-3*compactMargin)
	}
	wruntime.EventsEmit(ctx, "overlay:compact")
}
