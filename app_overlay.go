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
	visible  bool
	hotkey   string
	hotkeyOK bool
	keypad   []KeypadKey
	stopKey  func()
	stopPad  func() // direct USB reading of the keypad
	padOn    bool   // keypad plugged in and read directly
	reading  *overlay.ReadingService
	gestures *overlay.GestureControl
	bubble   bool // shrunk to the summary bubble next to the pointer (option 4, app_summary.go)
}

// startOverlay registers the shortcut; the window starts visible so the person sees it once.
func (a *App) startOverlay(ctx context.Context) {
	o := &a.overlay
	o.visible = true
	o.reading = overlay.NewReadingService()
	o.gestures = overlay.NewGestureControl()
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
	if action == overlay.KeypadToggle {
		a.toggleOverlay(ctx)
		return
	}
	o := &a.overlay
	o.mu.Lock()
	show := !o.visible || !overlay.ForegroundIsOurs()
	o.visible = true
	o.mu.Unlock()
	if show {
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
	if o.gestures != nil {
		o.gestures.Stop()
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
	wruntime.WindowShow(ctx)
	wruntime.WindowUnminimise(ctx)
	wruntime.WindowCenter(ctx)
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	wruntime.EventsEmit(ctx, "overlay:shown")
}

// OverlayInfo tells the UI how the overlay is opened.
type OverlayInfo struct {
	Hotkey   string      `json:"hotkey"`
	HotkeyOK bool        `json:"hotkeyOk"` // false: no shortcut can show the window (taken, or not Windows)
	Keypad   []KeypadKey `json:"keypad"`
	// KeypadConnected: the MX Keypad is plugged in and read directly (no Logi Options+ needed).
	KeypadConnected bool `json:"keypadConnected"`
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
	return toJSON(OverlayInfo{Hotkey: o.hotkey, HotkeyOK: o.hotkeyOK, Keypad: o.keypad, KeypadConnected: on})
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

// ---- Option "Gestures" (Nil): Gesture Control, a separate program with its own camera window ----

func (a *App) StartGestures() error  { return a.overlay.gestures.Start() }
func (a *App) StopGestures()         { a.overlay.gestures.Stop() }
func (a *App) GesturesRunning() bool { return a.overlay.gestures.Running() }
