//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// macDesktop uses AppleScript (osascript). The terminal running this program needs the
// Accessibility permission (System Settings → Privacy & Security → Accessibility).
// Mouse control needs `cliclick` (brew install cliclick).
type macDesktop struct{ w, h int }

func newDesktop(w, h int) Desktop { return &macDesktop{w: w, h: h} }

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

func (d *macDesktop) SetVolume(v float64) error {
	return osascript(fmt.Sprintf("set volume output volume %d", int(v*100+0.5)))
}

func (d *macDesktop) FocusWindow(app CallApp) error {
	return osascript(fmt.Sprintf(`tell application "%s" to activate`, app.MacApp))
}
