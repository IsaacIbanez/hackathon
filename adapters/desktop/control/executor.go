package control

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

// Desktop is what each operating system implements to act on the real computer.
type Desktop interface {
	Name() string
	PressKeys(c Combo) error
	// MoveMouse moves the cursor to (x, y), normalized to [0, 1] over the primary screen.
	MoveMouse(x, y float64) error
	Click() error
	MouseDown() error
	MouseUp() error
	RightClick() error
	// Scroll turns the mouse wheel: positive notches scroll up, negative down.
	Scroll(notches int) error
	// OnScreenKeyboard opens the system's on-screen keyboard (to type with the gesture mouse).
	OnScreenKeyboard() error
	// SetVolume sets the system output volume, from 0 to 1.
	SetVolume(v float64) error
	SetBrightness(v float64) error
	ToggleMicMute() (state string, err error)
	Power(kind string) error
	OpenApp(argv []string) error
	// FocusWindow brings the call app's window to the front before sending its shortcuts.
	FocusWindow(app CallApp) error
}

var (
	ErrUnsupported     = errors.New("not supported on this system")
	ErrUnknownAction   = errors.New("unknown action")
	ErrNeedsConfirm    = errors.New("action requires confirmation")
	ErrWindowNotFound  = errors.New("window not found")
	ErrUnknownLauncher = errors.New("unknown launcher")
)

// Request is what the gesture page sends for each recognized action.
type Request struct {
	Action  string   `json:"action"`
	Value   *float64 `json:"value,omitempty"`
	App     string   `json:"app,omitempty"`
	Confirm bool     `json:"confirm,omitempty"`
	Target  string   `json:"target,omitempty"`
}

// Executor turns requests into operations on a Desktop.
type Executor struct {
	Desktop Desktop
	GOOS    string
	// Pause between focusing a window and sending its shortcut (the window needs a moment).
	FocusDelay time.Duration
	Launchers  []Launcher
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
	case "brightness":
		if r.Value == nil || *r.Value < 0 || *r.Value > 1 {
			return "", fmt.Errorf("brightness needs a value between 0 and 1")
		}
		val := *r.Value
		if val < 0.05 {
			val = 0.05
		}
		return fmt.Sprintf("brightness %d %%", int(val*100+0.5)), e.Desktop.SetBrightness(val)
	case "keyboard":
		return "on-screen keyboard", e.Desktop.OnScreenKeyboard()
	case "mic_mute":
		state, err := e.Desktop.ToggleMicMute()
		if err != nil {
			return "", err
		}
		switch state {
		case "muted":
			return "microphone muted", nil
		case "unmuted":
			return "microphone on", nil
		default:
			return "microphone toggled", nil
		}
	case "suspend", "restart", "shutdown":
		if !r.Confirm {
			return "", ErrNeedsConfirm
		}
		if err := e.Desktop.Power(r.Action); err != nil {
			return "", err
		}
		return r.Action, nil
	case "open_app":
		var launcher *Launcher
		for i := range e.Launchers {
			if e.Launchers[i].ID == r.Target {
				launcher = &e.Launchers[i]
				break
			}
		}
		if launcher == nil {
			return "", fmt.Errorf("%w: %q", ErrUnknownLauncher, r.Target)
		}
		argv, err := launcher.Argv(e.GOOS)
		if err != nil {
			return "", err
		}
		if err := e.Desktop.OpenApp(argv); err != nil {
			return "", err
		}
		return fmt.Sprintf("opened %s", launcher.Name), nil
	}

	combos, ok := Shortcuts(r.Action, r.App, e.GOOS)
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrUnknownAction, r.Action)
	}
	did := r.Action
	if CallActions[r.Action] {
		app, _ := FindCallApp(r.App)
		did = fmt.Sprintf("%s in %s", r.Action, app.Name)
		// The call's window must be found: otherwise the shortcut would go to whatever window is
		// active (Ctrl+D in another app does something else entirely). Only where focusing isn't
		// supported at all (some Linux desktops) does it go to the active window.
		if err := e.Desktop.FocusWindow(app); errors.Is(err, ErrWindowNotFound) {
			return "", fmt.Errorf("%s window not found: open the call first", app.Name)
		} else if err != nil {
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

// Mouse performs a mouse button action: down, up, click, or right_click.
func (e *Executor) Mouse(action string) error {
	switch action {
	case "down":
		return e.Desktop.MouseDown()
	case "up":
		return e.Desktop.MouseUp()
	case "click":
		return e.Desktop.Click()
	case "right_click":
		return e.Desktop.RightClick()
	case "scroll_up":
		return e.Desktop.Scroll(1)
	case "scroll_down":
		return e.Desktop.Scroll(-1)
	default:
		return fmt.Errorf("unknown mouse action %q", action)
	}
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
func (d *DryRun) MouseDown() error              { return d.record("mouse down") }
func (d *DryRun) MouseUp() error                { return d.record("mouse up") }
func (d *DryRun) RightClick() error             { return d.record("mouse right_click") }
func (d *DryRun) Scroll(n int) error            { return d.record(fmt.Sprintf("scroll %d", n)) }
func (d *DryRun) OnScreenKeyboard() error       { return d.record("keyboard") }
func (d *DryRun) SetVolume(v float64) error     { return d.record(fmt.Sprintf("volume %.2f", v)) }
func (d *DryRun) SetBrightness(v float64) error { return d.record(fmt.Sprintf("brightness %.2f", v)) }
func (d *DryRun) ToggleMicMute() (string, error) {
	_ = d.record("mic toggle")
	return "toggled", nil
}
func (d *DryRun) Power(kind string) error { return d.record("power " + kind) }
func (d *DryRun) OpenApp(argv []string) error {
	return d.record("open " + strings.Join(argv, " "))
}
func (d *DryRun) FocusWindow(app CallApp) error { return d.record("focus " + app.ID) }

// screenPixels converts normalized coordinates to pixels.
func screenPixels(x, y float64, w, h int) (int, int) {
	return int(x*float64(w-1) + 0.5), int(y*float64(h-1) + 0.5)
}
