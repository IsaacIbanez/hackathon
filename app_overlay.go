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

// Size of the full overlay window (main.go opens it with this size; the summary bubble restores it).
const (
	overlayWidth  = 960
	overlayHeight = 680
)

type overlayState struct {
	build    overlay.BuildInfo // the running executable (R4)
	another  bool              // another copy of the app was already running
	mu       sync.Mutex
	visible  bool
	hotkey   string
	hotkeyOK bool
	keypad   []KeypadKey
	stopKey  func()
	stopPad  func() // direct USB reading of the keypad
	padOn    bool   // keypad plugged in and read directly
	reading  *overlay.ReadingService
	// Gesture Control (role C) runs inside this app: its camera page is option 1 and its actions
	// go through GestureCall, with no separate program, port or token.
	gestures   *control.Server
	gesturesOn bool // option 1 is showing the camera
	compact    bool // shrunk to a camera bubble in a corner instead of hidden
	screen     bool // from the bubble: see-through over the whole screen while the gesture menu is open
	leftCorner bool // the bubble sits in the bottom-left corner (it dodges the gesture cursor)
	// The program that was active before the full-screen menu: it gets the focus back afterwards,
	// so the gestures' keys (Enter, shortcuts) go to it and not to this window.
	before uintptr
	bubble bool // shrunk to the summary bubble next to the pointer (option 4, app_summary.go)
	// layer: the overlay covers the whole screen as a see-through layer (the menu and the reading
	// options, docs/DISENO.md); false for Gesture Control, whose clicks must reach the programs below.
	layer bool
}

// startOverlay registers the shortcut; the window starts visible so the person sees it once.
func (a *App) startOverlay(ctx context.Context) {
	o := &a.overlay
	// R4: say which build this is and whether another copy is already running, before it grabs
	// the shortcuts, the keypad and the camera.
	o.build = overlay.Build()
	log.Printf("version: %s", o.build)
	if o.another = overlay.AnotherInstance(); o.another {
		log.Printf("overlay: another copy of the app is already running: close it (shortcuts, keypad and camera will clash)")
	}
	o.visible = true
	o.reading = overlay.NewReadingService()
	o.gestures = newGestureControl()
	h, err := overlay.HotkeyFromEnv()
	if err != nil {
		log.Printf("overlay: %v; using %s", err, overlay.DefaultHotkey)
		h, _ = overlay.ParseHotkey(overlay.DefaultHotkey)
	}
	o.hotkey = h.String()
	// The MX Keypad keys (docs/KEYPAD.md) are registered with the main shortcut, on the same thread.
	pad, err := overlay.KeypadFromEnv()
	if err != nil {
		log.Printf("overlay: %v (keypad off)", err)
	}
	keys := []overlay.Hotkey{h}
	for _, k := range pad {
		keys = append(keys, k.Hotkey)
	}
	stop, errs := overlay.ListenAll(keys, func(i int) {
		if i == 0 {
			a.toggleOverlay(ctx)
		} else {
			a.keypadPressed(ctx, pad[i-1].Action)
		}
	})
	o.stopKey = stop
	o.hotkeyOK = errs[0] == nil
	if o.hotkeyOK {
		log.Printf("overlay: press %s to show or hide the overlay", h)
	} else {
		log.Printf("overlay: %v", errs[0])
	}
	for i, k := range pad {
		ok := errs[i+1] == nil
		o.keypad = append(o.keypad, KeypadKey{Shortcut: k.Hotkey.String(), Action: string(k.Action), OK: ok})
		if !ok {
			log.Printf("overlay: keypad: %v", errs[i+1])
		} else if k.Action == overlay.KeypadToggle {
			o.hotkeyOK = true // the keypad can bring the window back too
		}
	}
	if len(pad) > 0 {
		log.Printf("overlay: %d keypad shortcuts (docs/KEYPAD.md)", len(pad))
		// The keypad itself, read over USB without Logi Options+: key n does row n of the table.
		o.stopPad = overlay.ListenKeypad(func(n int) {
			if act, ok := overlay.KeypadActionForKey(n); ok {
				a.keypadPressed(ctx, act)
			}
		}, func(on bool) {
			o.mu.Lock()
			o.padOn = on
			o.mu.Unlock()
			log.Printf("overlay: MX Keypad read directly: connected=%v", on)
			wruntime.EventsEmit(ctx, "overlay:keypad-connected", on)
		})
	}
	if !o.hotkeyOK {
		log.Printf("overlay: no shortcut to show the window: it stays open")
	}
}

// keypadPressed runs an MX Keypad action: it shows the overlay if needed and tells the UI, which
// does the action (web/src/app/overlay/keypad.ts). It works while another program has the focus.
func (a *App) keypadPressed(ctx context.Context, action overlay.KeypadAction) {
	// Like the shortcut: remember the program in front before the overlay takes the focus, so
	// option 4 (summarize the selection) copies from it.
	overlay.RememberTarget()
	if action == overlay.KeypadToggle {
		a.toggleOverlay(ctx)
		return
	}
	o := &a.overlay
	o.mu.Lock()
	// From the gestures' camera bubble, a keypad key brings the full window back first.
	bubble := o.gesturesOn && o.compact
	show := !o.visible || !overlay.ForegroundIsOurs()
	o.visible = true
	o.mu.Unlock()
	if bubble {
		a.setCompact(ctx, false)
	} else if show {
		a.showOverlay(ctx)
	}
	wruntime.EventsEmit(ctx, "overlay:keypad", string(action))
}

func (a *App) stopOverlay() {
	o := &a.overlay
	if o.stopKey != nil {
		o.stopKey()
	}
	if o.stopPad != nil {
		o.stopPad()
	}
	if o.reading != nil {
		o.reading.Stop() // only if this app started it
	}
}

func (a *App) toggleOverlay(ctx context.Context) {
	// Remember the program in front before the overlay takes the focus: option 4 copies its
	// selected text.
	overlay.RememberTarget()
	o := &a.overlay
	o.mu.Lock()
	if o.bubble { // the summary bubble is open: the shortcut closes it
		o.mu.Unlock()
		a.CloseSummary()
		return
	}
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
		a.showOverlay(ctx)
	} else {
		wruntime.EventsEmit(ctx, "overlay:hidden")
		wruntime.WindowHide(ctx)
	}
}

func (a *App) showOverlay(ctx context.Context) {
	a.overlay.mu.Lock()
	layer := a.overlay.layer && !a.overlay.compact && !a.overlay.bubble
	a.overlay.mu.Unlock()
	wruntime.WindowShow(ctx)
	wruntime.WindowUnminimise(ctx)
	if layer {
		wruntime.WindowFullscreen(ctx)
	} else {
		wruntime.WindowCenter(ctx)
	}
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	wruntime.EventsEmit(ctx, "overlay:shown")
}

// SetLayer makes the overlay a see-through layer over the whole screen (true: the menu and the
// reading options, like Xbox Game Bar) or a normal window (false: Gesture Control, whose clicks
// must reach the programs below, and its camera bubble). The UI calls it when the view changes.
func (a *App) SetLayer(on bool) {
	o := &a.overlay
	o.mu.Lock()
	o.layer = on
	apply := o.visible && !o.compact && !o.bubble && !o.screen
	o.mu.Unlock()
	if !apply {
		return // applied the next time the window is shown
	}
	ctx := a.ctx
	if on {
		wruntime.WindowFullscreen(ctx)
		return
	}
	if wruntime.WindowIsFullscreen(ctx) {
		wruntime.WindowUnfullscreen(ctx)
	}
	wruntime.WindowSetSize(ctx, overlayWidth, overlayHeight)
	wruntime.WindowCenter(ctx)
}

// OverlayInfo tells the UI how the overlay is opened.
type OverlayInfo struct {
	Hotkey   string      `json:"hotkey"`
	HotkeyOK bool        `json:"hotkeyOk"` // false: no shortcut can show the window (taken, or not Windows)
	Keypad   []KeypadKey `json:"keypad"`
	// KeypadConnected: the MX Keypad is plugged in and read directly (no Logi Options+ needed).
	KeypadConnected bool `json:"keypadConnected"`
	// R4: the running build, what is missing to use every tool, and a second copy of the app.
	Version         overlay.BuildInfo `json:"version"`
	Problems        []overlay.Problem `json:"problems"`
	AnotherInstance bool              `json:"anotherInstance"`
}

// setupProblems lists what is missing (the AI key is known once the WebSocket handler started).
func (a *App) setupProblems() []overlay.Problem {
	return overlay.SetupProblems(overlay.RepoRoot(), a.hub != nil)
}

// logSetup writes the missing pieces to the log once the app has started.
func (a *App) logSetup() {
	for _, p := range a.setupProblems() {
		log.Printf("setup: %s %s", p.What, p.Fix)
	}
}

// KeypadKey is one MX Keypad shortcut and whether it could be registered.
type KeypadKey struct {
	Shortcut string `json:"shortcut"`
	Action   string `json:"action"`
	OK       bool   `json:"ok"`
}

// OverlayInfo returns OverlayInfo as JSON.
func (a *App) OverlayInfo() string {
	o := &a.overlay
	o.mu.Lock()
	on := o.padOn
	o.mu.Unlock()
	return toJSON(OverlayInfo{Hotkey: o.hotkey, HotkeyOK: o.hotkeyOK, Keypad: o.keypad, KeypadConnected: on,
		Version: o.build, Problems: a.setupProblems(), AnotherInstance: o.another})
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
	// Out of the full-screen gesture menu or of the full-screen layer (docs/DISENO.md).
	if wasScreen || wruntime.WindowIsFullscreen(ctx) {
		wruntime.WindowUnfullscreen(ctx)
	}
	wruntime.WindowShow(ctx)
	wruntime.WindowUnminimise(ctx)
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	if on {
		wruntime.WindowSetSize(ctx, compactWidth, compactHeight)
		a.placeBubble(ctx)
		wruntime.EventsEmit(ctx, "overlay:compact")
		return
	}
	wruntime.WindowSetSize(ctx, overlayWidth, overlayHeight)
	wruntime.WindowCenter(ctx)
	o.mu.Lock()
	layer := o.layer
	o.mu.Unlock()
	if layer { // back to the full-screen layer of the screen that was open
		wruntime.WindowFullscreen(ctx)
	}
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

// Title of the window (main.go); PlaceInCorner finds the window by it.
const windowTitle = "LauzHack overlay"

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
	if on {
		o.before = overlay.OtherForeground()
	}
	before := o.before
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
	a.placeBubble(ctx)
	wruntime.EventsEmit(ctx, "overlay:compact")
	overlay.RestoreForeground(before)
}

// placeBubble puts the bubble above the taskbar, in the bottom-right or bottom-left corner.
func (a *App) placeBubble(ctx context.Context) {
	a.overlay.mu.Lock()
	left := a.overlay.leftCorner
	a.overlay.mu.Unlock()
	// On Windows, in real pixels: Wails sizes windows scaled by the display scaling but positions
	// them unscaled, so with 125 % or 150 % scaling its corner is not the corner.
	if overlay.PlaceInCorner(windowTitle, left, compactMargin) {
		return
	}
	sw, sh := currentScreen(ctx)
	if sw == 0 {
		return
	}
	x := sw - compactWidth - compactMargin
	if left {
		x = compactMargin
	}
	wruntime.WindowSetPosition(ctx, x, sh-compactHeight-3*compactMargin)
}

// MoveBubble moves the camera bubble to the other bottom corner. The page calls it when the gesture
// cursor comes near the bubble: clicks on it would go to this window instead of the program below.
func (a *App) MoveBubble() {
	o := &a.overlay
	o.mu.Lock()
	if !o.compact || o.screen {
		o.mu.Unlock()
		return
	}
	o.leftCorner = !o.leftCorner
	o.mu.Unlock()
	a.placeBubble(a.ctx)
}
