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
	mu       sync.Mutex
	hotkey   string
	hotkeyOK bool
	keypad   []KeypadKey
	stopKey  func()
	stopPad  func()            // direct USB reading of the keypad
	padOn    bool              // keypad plugged in and read directly
	problems []string          // what the tools need and is missing (checkStartup), shown in the menu
	build    overlay.BuildInfo // which build is running (shown in the menu)
	reading  *overlay.ReadingService
	// Gesture Control (role C) runs inside this app: its camera page is option 1 and its actions
	// go through GestureCall, with no separate program, port or token. Whether the overlay is open,
	// a layer, a bubble… is not here: it is the window's shape (app_window.go).
	gestures *control.Server
}

// startOverlay registers the shortcut; the window starts visible so the person sees it once.
func (a *App) startOverlay(ctx context.Context) {
	o := &a.overlay
	// main.go opens the window as a normal window: the menu view asks for the layer right away.
	a.window.mu.Lock()
	a.window.in.open = true
	a.window.shape = shapeWindow
	a.window.mu.Unlock()
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
			a.keypadPressed(ctx, i, pad[i-1].Action)
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
				a.keypadPressed(ctx, n, act)
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
func (a *App) keypadPressed(ctx context.Context, key int, action overlay.KeypadAction) {
	log.Printf("overlay: keypad key %d -> %s", key, action)
	if action == overlay.KeypadOff {
		return // turned off: it does not even show the overlay
	}
	// Like the shortcut: remember the program in front before the overlay takes the focus, so
	// option 4 (summarize the selection) copies from it.
	overlay.RememberTarget()
	if action == overlay.KeypadToggle {
		a.toggleOverlay(ctx)
		return
	}
	// The overlay comes back as it was (from the bubble, hidden or covered) and runs the action.
	raise := !overlay.ForegroundIsOurs()
	a.setWindow(func(in *windowInputs) { in.open = true; in.summary = false }, raise)
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
	in := a.currentInputs()
	if in.summary { // the summary bubble is open: the shortcut closes it
		a.CloseSummary()
		return
	}
	// Open and in front: hide it (to the camera bubble if the gestures are on). Hidden, in the
	// bubble or covered by another window: bring it to the front as it was.
	if in.open && overlay.ForegroundIsOurs() {
		a.setWindow(func(in *windowInputs) { in.open = false }, false)
		return
	}
	a.setWindow(func(in *windowInputs) { in.open = true }, true)
}

// SetLayer: the current view wants the see-through layer over the whole screen (true: the menu and
// the reading options, like Xbox Game Bar) or a normal window (false: Gesture Control, whose clicks
// must reach the programs below). The UI calls it when the view changes.
func (a *App) SetLayer(on bool) {
	a.setWindow(func(in *windowInputs) { in.layer = on }, false)
}

// OverlayInfo tells the UI how the overlay is opened.
type OverlayInfo struct {
	Hotkey   string      `json:"hotkey"`
	HotkeyOK bool        `json:"hotkeyOk"` // false: no shortcut can show the window (taken, or not Windows)
	Keypad   []KeypadKey `json:"keypad"`
	// KeypadConnected: the MX Keypad is plugged in and read directly (no Logi Options+ needed).
	KeypadConnected bool `json:"keypadConnected"`
	// Problems: what a tool needs and is missing on this computer, each with what to do.
	Problems []string `json:"problems,omitempty"`
	// Version: which build is running, to tell an old .exe apart.
	Version overlay.BuildInfo `json:"version"`
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
	problems := o.problems
	build := o.build
	o.mu.Unlock()
	return toJSON(OverlayInfo{Hotkey: o.hotkey, HotkeyOK: o.hotkeyOK, Keypad: o.keypad, KeypadConnected: on, Problems: problems, Version: build})
}

func toJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// HideOverlay hides the overlay: to the camera bubble while the gestures are on, otherwise out of
// sight (the shortcut shows it again). Without any way back (no shortcut, no gestures) it only
// minimises, so the window can't get lost.
func (a *App) HideOverlay() {
	a.overlay.mu.Lock()
	hotkeyOK := a.overlay.hotkeyOK
	a.overlay.mu.Unlock()
	if !hotkeyOK && !a.currentInputs().gestures {
		wruntime.WindowMinimise(a.ctx)
		return
	}
	a.setWindow(func(in *windowInputs) { in.open = false }, false)
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
	// Suspend, restart and shut down: on, behind two confirmations in the menu (R2: a gesture
	// suspended the computer by accident); LAUZHACK_GESTURES_POWER=0 turns them off.
	power := os.Getenv("LAUZHACK_GESTURES_POWER") != "0"
	g := control.New(control.Options{DryRun: dry, Width: w, Height: h, Apps: os.Getenv("LAUZHACK_APPS"), AllowPower: power})
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

// SetGesturesActive tells Go that the gesture engine is using the camera (true) or has stopped
// (false: PDF Scanner borrowed the camera). While it is on, a hidden overlay stays as a camera bubble.
func (a *App) SetGesturesActive(on bool) {
	a.setWindow(func(in *windowInputs) {
		in.gestures = on
		if !on {
			in.gestureScreen = false
		}
	}, false)
}

// SetCompact(true) hides the overlay to the camera bubble ("Shrink to a camera bubble", M);
// SetCompact(false) brings the overlay back as it was (a double click on the bubble).
func (a *App) SetCompact(on bool) {
	a.setWindow(func(in *windowInputs) { in.open = !on }, !on)
}

const (
	compactWidth  = 360
	compactHeight = 240
	compactMargin = 24
)

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
// windows (a video call, for example): the gestures follow the hand from the camera there. It also
// lets the page play and record audio without a click inside it: here the person acts with the MX
// Keypad or the hand, and Chromium's autoplay policy otherwise leaves the audio suspended (the voice
// command's beep and recording). Only if nobody set these arguments already.
func keepCameraRunning() {
	const env = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
	if os.Getenv(env) != "" {
		return
	}
	_ = os.Setenv(env, "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required")
}

// SetScreenOverlay: the gesture menu or the volume/brightness control is open (true) or closed
// (false). While open the window spreads see-through over the whole screen, with the camera small
// in a corner; when it closes the window goes back to exactly the shape it had (app_window.go).
func (a *App) SetScreenOverlay(on bool) {
	a.setWindow(func(in *windowInputs) { in.gestureScreen = on }, false)
}

// placeBubble puts the camera bubble in the top-left corner (top right after it dodged the gesture
// cursor). Isaac, 2026-11-22: small, top left, and it only moves when the hand's cursor is on it.
func (a *App) placeBubble(ctx context.Context) {
	a.window.mu.Lock()
	left := !a.window.rightCorner
	a.window.mu.Unlock()
	// On Windows, in real pixels: Wails sizes windows scaled by the display scaling but positions
	// them unscaled, so with 125 % or 150 % scaling its corner is not the corner.
	if overlay.PlaceInCorner(windowTitle, left, true, compactMargin) {
		return
	}
	sw, _ := currentScreen(ctx)
	if sw == 0 {
		return
	}
	x := sw - compactWidth - compactMargin
	if left {
		x = compactMargin
	}
	wruntime.WindowSetPosition(ctx, x, compactMargin)
}

// MoveBubble moves the camera bubble to the other top corner. The page calls it when the gesture
// cursor comes near the bubble: clicks on it would go to this window instead of the program below.
func (a *App) MoveBubble() {
	w := &a.window
	w.mu.Lock()
	if w.shape != shapeBubble {
		w.mu.Unlock()
		return
	}
	w.rightCorner = !w.rightCorner
	w.mu.Unlock()
	a.placeBubble(a.ctx)
}
