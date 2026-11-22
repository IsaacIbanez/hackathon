//go:build darwin

package control

import (
	"fmt"
	"os/exec"
	"strings"
)

// macDesktop uses AppleScript (osascript). The terminal running this program needs the
// Accessibility permission (System Settings → Privacy & Security → Accessibility).
// Mouse control needs `cliclick` (brew install cliclick).
type macDesktop struct {
	w, h          int
	savedInputVol int
}

func NewDesktop(w, h int) Desktop { return &macDesktop{w: w, h: h} }

func (d *macDesktop) Name() string { return "macOS (AppleScript)" }

func osascript(script string) error {
	out, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("osascript: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

var macKeyCodes = map[string]int{"enter": 36, "escape": 53, "tab": 48, "space": 49}
var macMods = map[string]string{"ctrl": "control down", "shift": "shift down", "alt": "option down", "meta": "command down"}

func (d *macDesktop) PressKeys(c Combo) error {
	mods := []string{}
	for _, m := range c.Mods {
		mods = append(mods, macMods[m])
	}
	using := ""
	if len(mods) > 0 {
		using = " using {" + strings.Join(mods, ", ") + "}"
	}
	if code, ok := macKeyCodes[c.Key]; ok {
		return osascript(fmt.Sprintf(`tell application "System Events" to key code %d%s`, code, using))
	}
	return osascript(fmt.Sprintf(`tell application "System Events" to keystroke "%s"%s`, c.Key, using))
}

func (d *macDesktop) screen() (int, int, error) {
	if d.w > 0 && d.h > 0 {
		return d.w, d.h, nil
	}
	out, err := exec.Command("osascript", "-e", `tell application "Finder" to get bounds of window of desktop`).Output()
	if err != nil {
		return 0, 0, err
	}
	var x0, y0, w, h int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%d, %d, %d, %d", &x0, &y0, &w, &h); err != nil {
		return 0, 0, err
	}
	d.w, d.h = w, h
	return w, h, nil
}

func (d *macDesktop) MoveMouse(x, y float64) error {
	if _, err := exec.LookPath("cliclick"); err != nil {
		return fmt.Errorf("%w: install cliclick (brew install cliclick)", ErrUnsupported)
	}
	w, h, err := d.screen()
	if err != nil {
		return err
	}
	px, py := screenPixels(x, y, w, h)
	return exec.Command("cliclick", fmt.Sprintf("m:%d,%d", px, py)).Run()
}

func (d *macDesktop) Click() error {
	if _, err := exec.LookPath("cliclick"); err != nil {
		return fmt.Errorf("%w: install cliclick (brew install cliclick)", ErrUnsupported)
	}
	return exec.Command("cliclick", "c:.").Run()
}

func (d *macDesktop) MouseDown() error {
	if _, err := exec.LookPath("cliclick"); err != nil {
		return fmt.Errorf("%w: install cliclick (brew install cliclick)", ErrUnsupported)
	}
	return exec.Command("cliclick", "dd:.").Run()
}

func (d *macDesktop) MouseUp() error {
	if _, err := exec.LookPath("cliclick"); err != nil {
		return fmt.Errorf("%w: install cliclick (brew install cliclick)", ErrUnsupported)
	}
	return exec.Command("cliclick", "du:.").Run()
}

func (d *macDesktop) RightClick() error {
	if _, err := exec.LookPath("cliclick"); err != nil {
		return fmt.Errorf("%w: install cliclick (brew install cliclick)", ErrUnsupported)
	}
	return exec.Command("cliclick", "rc:.").Run()
}

func (d *macDesktop) SetVolume(v float64) error {
	return osascript(fmt.Sprintf("set volume output volume %d", int(v*100+0.5)))
}

func (d *macDesktop) SetBrightness(v float64) error {
	if _, err := exec.LookPath("brightness"); err == nil {
		return exec.Command("brightness", fmt.Sprintf("%.2f", v)).Run()
	}
	steps := int(v*16 + 0.5)
	script := fmt.Sprintf(`tell application "System Events"
		repeat 16 times
			key code 145
		end repeat
		repeat %d times
			key code 144
		end repeat
	end tell`, steps)
	return osascript(script)
}

// Level reads the output volume (brightness has no simple reader on macOS).
func (d *macDesktop) Level(target string) (float64, error) {
	if target != "volume" {
		return 0, ErrUnsupported
	}
	out, err := exec.Command("osascript", "-e", "output volume of (get volume settings)").Output()
	if err != nil {
		return 0, fmt.Errorf("osascript: %v", err)
	}
	return parsePercent(string(out))
}

// MicMuted: "muted" on macOS is an input volume of 0 (see ToggleMicMute).
func (d *macDesktop) MicMuted() (bool, error) {
	out, err := exec.Command("osascript", "-e", "input volume of (get volume settings)").Output()
	if err != nil {
		return false, fmt.Errorf("osascript: %v", err)
	}
	var current int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%d", &current); err != nil {
		return false, fmt.Errorf("parse input volume %q: %v", string(out), err)
	}
	return current == 0, nil
}

func (d *macDesktop) ToggleMicMute() (string, error) {
	out, err := exec.Command("osascript", "-e", "input volume of (get volume settings)").Output()
	if err != nil {
		return "", fmt.Errorf("osascript: %v", err)
	}
	var current int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%d", &current); err != nil {
		return "", fmt.Errorf("parse input volume %q: %v", string(out), err)
	}
	if current > 0 {
		d.savedInputVol = current
		if err := osascript("set volume input volume 0"); err != nil {
			return "", err
		}
		return "muted", nil
	}
	restore := d.savedInputVol
	if restore <= 0 {
		restore = 75
	}
	if err := osascript(fmt.Sprintf("set volume input volume %d", restore)); err != nil {
		return "", err
	}
	return "unmuted", nil
}

func (d *macDesktop) Power(kind string) error {
	switch kind {
	case "suspend":
		return exec.Command("pmset", "sleepnow").Run()
	case "restart":
		return osascript(`tell application "System Events" to restart`)
	case "shutdown":
		return osascript(`tell application "System Events" to shut down`)
	default:
		return fmt.Errorf("unknown power action %q", kind)
	}
}

func (d *macDesktop) OpenApp(argv []string) error {
	return openProcess(argv)
}

func (d *macDesktop) FocusWindow(app CallApp) error {
	return osascript(fmt.Sprintf(`tell application "%s" to activate`, app.MacApp))
}

func (d *macDesktop) Scroll(int) error {
	return fmt.Errorf("%w: scrolling with gestures is not available on macOS yet", ErrUnsupported)
}

// OnScreenKeyboard opens the Accessibility Keyboard settings (macOS has no command to show it).
func (d *macDesktop) OnScreenKeyboard() error {
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.universalaccess?Keyboard").Run()
}
