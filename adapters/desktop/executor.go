package main

import (
	"errors"
	"fmt"
	"log"
	"time"
)

// Desktop is what each operating system implements to act on the real computer.
type Desktop interface {
	Name() string
	PressKeys(c Combo) error
	// MoveMouse moves the cursor to (x, y), normalized to [0, 1] over the primary screen.
	MoveMouse(x, y float64) error
	Click() error
	// SetVolume sets the system output volume, from 0 to 1.
	SetVolume(v float64) error
	// FocusWindow brings the call app's window to the front before sending its shortcuts.
	FocusWindow(app CallApp) error
}

var (
	ErrUnsupported   = errors.New("not supported on this system")
	ErrUnknownAction = errors.New("unknown action")
)

// Request is what the gesture page sends for each recognized action.
type Request struct {
	Action string   `json:"action"`
	Value  *float64 `json:"value,omitempty"`
	App    string   `json:"app,omitempty"`
}

// Executor turns requests into operations on a Desktop.
type Executor struct {
	Desktop Desktop
	GOOS    string
	// Pause between focusing a window and sending its shortcut (the window needs a moment).
	FocusDelay time.Duration
}

// Do performs the request and returns a short human-readable description of what was done.
func (e *Executor) Do(r Request) (string, error) {
	switch r.Action {
	case "click":
		return "click", e.Desktop.Click()
	case "volume":
		if r.Value == nil || *r.Value < 0 || *r.Value > 1 {
			return "", fmt.Errorf("volume needs a value between 0 and 1")
		}
		return fmt.Sprintf("volume %d %%", int(*r.Value*100+0.5)), e.Desktop.SetVolume(*r.Value)
	}

	combos, ok := Shortcuts(r.Action, r.App, e.GOOS)
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrUnknownAction, r.Action)
	}
	did := r.Action
	if CallActions[r.Action] {
		app, _ := FindCallApp(r.App)
		did = fmt.Sprintf("%s in %s", r.Action, app.Name)
		// Best effort: if the window can't be focused, the shortcut goes to the focused window.
		if err := e.Desktop.FocusWindow(app); err != nil {
			log.Printf("focus %s: %v", app.Name, err)
		} else if e.FocusDelay > 0 {
			time.Sleep(e.FocusDelay)
		}
	}
	for i, c := range combos {
		if i > 0 {
			time.Sleep(150 * time.Millisecond)
		}
		if err := e.Desktop.PressKeys(c); err != nil {
			return "", err
		}
	}
	return did, nil
}

// MovePointer moves the mouse; x and y are normalized to [0, 1].
func (e *Executor) MovePointer(x, y float64) error {
	if x < 0 || x > 1 || y < 0 || y > 1 {
		return fmt.Errorf("pointer out of range: %.3f, %.3f", x, y)
	}
	return e.Desktop.MoveMouse(x, y)
}

// DryRun logs what it would do instead of touching the computer. Used by -dry-run and the tests.
type DryRun struct {
	Calls []string
}

func (d *DryRun) Name() string { return "dry run" }
func (d *DryRun) record(s string) error {
	d.Calls = append(d.Calls, s)
	log.Printf("[dry run] %s", s)
	return nil
}
func (d *DryRun) PressKeys(c Combo) error       { return d.record("keys " + c.String()) }
func (d *DryRun) MoveMouse(x, y float64) error  { return d.record(fmt.Sprintf("move %.2f %.2f", x, y)) }
func (d *DryRun) Click() error                  { return d.record("click") }
func (d *DryRun) SetVolume(v float64) error     { return d.record(fmt.Sprintf("volume %.2f", v)) }
func (d *DryRun) FocusWindow(app CallApp) error { return d.record("focus " + app.ID) }
