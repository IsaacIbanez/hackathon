package main

import (
	"context"
	"log"
	"sync"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/IsaacIbanez/hackathon/backend/overlay"
)

// The app is ONE Wails window that takes several shapes. Before, six bindings (SetLayer, SetCompact,
// SetScreenOverlay, HideOverlay, the summary bubble and the shortcut) each moved the window on their
// own, so the gesture menu or the cursor mode could shrink or close the overlay (fix R5,
// docs/VENTANA.md). Now every part only says what it wants (windowInputs) and applyShape works out
// the one shape from a fixed hierarchy and applies it. Gesture Control coexists with everything:
// it never opens, hides or shrinks the overlay, it only lays its menu over it for a moment.

// windowShape is what the window looks like.
type windowShape int

const (
	shapeHidden        windowShape = iota // nothing on screen
	shapeLayer                            // the overlay as a see-through layer over the whole screen (menu, reading tools)
	shapeWindow                           // the overlay as a normal centred window (Gesture Control's page: its clicks reach the programs below)
	shapeBubble                           // overlay hidden but the gestures alive: a camera bubble in a corner
	shapeGestureScreen                    // the gesture menu or the volume/brightness control, see-through over the whole screen
	shapeSummary                          // the AI Summary bubble next to the pointer
)

func (s windowShape) String() string {
	return [...]string{"hidden", "layer", "window", "bubble", "gesture-screen", "summary"}[s]
}

// windowInputs is what the parts of the app want; nothing else decides the shape.
type windowInputs struct {
	open          bool // the person wants the overlay on screen (shortcut, keypad, Hide, Esc, bubble double click)
	layer         bool // the current view wants the full-screen layer (false: Gesture Control's normal window)
	gestures      bool // the gesture engine is using the camera (the whole app since N1; paused by PDF Scanner)
	gestureScreen bool // the gesture menu or the level control is open (temporary)
	summary       bool // the AI Summary bubble is open (temporary)
}

// desiredShape is the hierarchy, highest first:
//  1. the summary bubble (an action the person just asked for; temporary);
//  2. the gesture menu screen (temporary: when it closes the window goes back to exactly what it was);
//  3. the overlay, as a layer or as a window, if it is open;
//  4. the camera bubble, if it is hidden but the gestures are on;
//  5. hidden.
func desiredShape(in windowInputs) windowShape {
	switch {
	case in.summary:
		return shapeSummary
	case in.gestureScreen && in.gestures:
		return shapeGestureScreen
	case in.open && in.layer:
		return shapeLayer
	case in.open:
		return shapeWindow
	case in.gestures:
		return shapeBubble
	default:
		return shapeHidden
	}
}

// windowControl holds the inputs and the shape the window has now.
type windowControl struct {
	mu         sync.Mutex
	in         windowInputs
	shape      windowShape
	leftCorner bool    // the camera bubble sits in the bottom-left corner (it dodges the gesture cursor)
	before     uintptr // the program in front before the gesture menu screen: it gets the focus back
	applying   sync.Mutex
}

// setWindow changes the inputs (under the lock) and applies the resulting shape. raise: also bring the
// window to the front even if the shape does not change (the shortcut on a covered overlay).
func (a *App) setWindow(change func(*windowInputs), raise bool) {
	w := &a.window
	w.mu.Lock()
	change(&w.in)
	w.mu.Unlock()
	a.applyShape(a.ctx, raise)
}

func (a *App) currentInputs() windowInputs {
	a.window.mu.Lock()
	defer a.window.mu.Unlock()
	return a.window.in
}

// applyShape makes the window match desiredShape. One transition at a time.
func (a *App) applyShape(ctx context.Context, raise bool) {
	if ctx == nil {
		return
	}
	w := &a.window
	w.applying.Lock()
	defer w.applying.Unlock()
	w.mu.Lock()
	from, to := w.shape, desiredShape(w.in)
	w.mu.Unlock()
	if from == to && !raise {
		return
	}
	log.Printf("window: %s -> %s", from, to)
	opening := from == shapeHidden || from == shapeBubble || from == shapeSummary

	if to != shapeGestureScreen && to != shapeLayer && wruntime.WindowIsFullscreen(ctx) {
		wruntime.WindowUnfullscreen(ctx)
	}
	switch to {
	case shapeHidden:
		wruntime.EventsEmit(ctx, "overlay:hidden")
		wruntime.WindowHide(ctx)
	case shapeLayer, shapeWindow:
		wruntime.WindowShow(ctx)
		wruntime.WindowUnminimise(ctx)
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		if to == shapeLayer {
			wruntime.WindowFullscreen(ctx)
		} else {
			wruntime.WindowSetSize(ctx, overlayWidth, overlayHeight)
			wruntime.WindowCenter(ctx)
		}
		wruntime.EventsEmit(ctx, "overlay:expanded") // the gesture page leaves the bubble and the menu screen
		if opening || raise {
			wruntime.EventsEmit(ctx, "overlay:shown") // the page takes the keyboard focus
		}
	case shapeBubble:
		wruntime.WindowShow(ctx)
		wruntime.WindowUnminimise(ctx)
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		wruntime.WindowSetSize(ctx, compactWidth, compactHeight)
		a.placeBubble(ctx)
		wruntime.EventsEmit(ctx, "overlay:compact")
		if from == shapeGestureScreen {
			w.mu.Lock()
			before := w.before
			w.mu.Unlock()
			overlay.RestoreForeground(before) // the gestures' keys go back to the program below
		}
	case shapeGestureScreen:
		if from == shapeBubble || from == shapeHidden {
			fg := overlay.OtherForeground()
			w.mu.Lock()
			w.before = fg
			w.mu.Unlock()
		}
		wruntime.WindowShow(ctx)
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		wruntime.WindowFullscreen(ctx)
		wruntime.EventsEmit(ctx, "overlay:screen")
	case shapeSummary:
		wruntime.WindowShow(ctx)
		wruntime.WindowSetAlwaysOnTop(ctx, true)
		where, placed := overlay.PlaceNearCursor(bubbleWidth, bubbleHeight)
		log.Printf("summary: bubble %s", where)
		if !placed {
			wruntime.WindowSetSize(ctx, bubbleWidth, bubbleHeight)
			wruntime.WindowCenter(ctx)
		}
	}
	w.mu.Lock()
	w.shape = to
	w.mu.Unlock()
}

// WindowShape tells the UI the current shape (for diagnostics and the version bar).
func (a *App) WindowShape() string {
	a.window.mu.Lock()
	defer a.window.mu.Unlock()
	return a.window.shape.String()
}
