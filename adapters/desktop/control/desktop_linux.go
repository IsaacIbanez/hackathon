//go:build linux

package control

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// linuxDesktop drives the computer through command-line tools:
// X11 → xdotool; Wayland → wtype (keys) and ydotool (mouse); volume → wpctl, pactl or amixer.
type linuxDesktop struct {
	wayland bool
	w, h    int // screen size in pixels (0 = detect)
}

func NewDesktop(w, h int) Desktop {
	return &linuxDesktop{wayland: os.Getenv("WAYLAND_DISPLAY") != "", w: w, h: h}
}

func (d *linuxDesktop) Name() string {
	if d.wayland {
		return "Linux (Wayland: wtype, ydotool)"
	}
	return "Linux (X11: xdotool)"
}

func has(tool string) bool {
	_, err := exec.LookPath(tool)
	return err == nil
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

var xKeys = map[string]string{"enter": "Return", "escape": "Escape", "tab": "Tab", "space": "space"}
var xMods = map[string]string{"ctrl": "ctrl", "shift": "shift", "alt": "alt", "meta": "super"}
var wtypeMods = map[string]string{"ctrl": "ctrl", "shift": "shift", "alt": "alt", "meta": "logo"}

func keysym(key string) string {
	if k, ok := xKeys[key]; ok {
		return k
	}
	return key
}

func (d *linuxDesktop) PressKeys(c Combo) error {
	if !d.wayland && has("xdotool") {
		parts := []string{}
		for _, m := range c.Mods {
			parts = append(parts, xMods[m])
		}
		parts = append(parts, keysym(c.Key))
		return run("xdotool", "key", "--clearmodifiers", strings.Join(parts, "+"))
	}
	if d.wayland && has("wtype") {
		args := []string{}
		for _, m := range c.Mods {
			args = append(args, "-M", wtypeMods[m])
		}
		args = append(args, "-k", keysym(c.Key))
		for i := len(c.Mods) - 1; i >= 0; i-- {
			args = append(args, "-m", wtypeMods[c.Mods[i]])
		}
		return run("wtype", args...)
	}
	return fmt.Errorf("%w: install xdotool (X11) or wtype (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) screen() (int, int, error) {
	if d.w > 0 && d.h > 0 {
		return d.w, d.h, nil
	}
	if !d.wayland && has("xdotool") {
		out, err := exec.Command("xdotool", "getdisplaygeometry").Output()
		if err == nil {
			var w, h int
			if _, err := fmt.Sscan(string(out), &w, &h); err == nil {
				d.w, d.h = w, h
				return w, h, nil
			}
		}
	}
	if has("hyprctl") {
		out, err := exec.Command("hyprctl", "monitors", "-j").Output()
		if err == nil {
			var mons []struct {
				Width, Height int
				Focused       bool
			}
			if json.Unmarshal(out, &mons) == nil {
				for _, m := range mons {
					if m.Focused || len(mons) == 1 {
						d.w, d.h = m.Width, m.Height
						return d.w, d.h, nil
					}
				}
			}
		}
	}
	return 0, 0, fmt.Errorf("%w: can't detect the screen size, start with -screen 1920x1080", ErrUnsupported)
}

func (d *linuxDesktop) MoveMouse(x, y float64) error {
	w, h, err := d.screen()
	if err != nil {
		return err
	}
	px, py := screenPixels(x, y, w, h)
	if !d.wayland && has("xdotool") {
		return run("xdotool", "mousemove", fmt.Sprint(px), fmt.Sprint(py))
	}
	if has("ydotool") {
		return run("ydotool", "mousemove", "--absolute", "-x", fmt.Sprint(px), "-y", fmt.Sprint(py))
	}
	return fmt.Errorf("%w: install xdotool (X11) or ydotool (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) Click() error {
	if !d.wayland && has("xdotool") {
		return run("xdotool", "click", "1")
	}
	if has("ydotool") {
		return run("ydotool", "click", "0xC0")
	}
	return fmt.Errorf("%w: install xdotool (X11) or ydotool (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) MouseDown() error {
	if !d.wayland && has("xdotool") {
		return run("xdotool", "mousedown", "1")
	}
	if has("ydotool") {
		return run("ydotool", "click", "0x40")
	}
	return fmt.Errorf("%w: install xdotool (X11) or ydotool (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) MouseUp() error {
	if !d.wayland && has("xdotool") {
		return run("xdotool", "mouseup", "1")
	}
	if has("ydotool") {
		return run("ydotool", "click", "0x80")
	}
	return fmt.Errorf("%w: install xdotool (X11) or ydotool (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) RightClick() error {
	if !d.wayland && has("xdotool") {
		return run("xdotool", "click", "3")
	}
	if has("ydotool") {
		return run("ydotool", "click", "0xC1")
	}
	return fmt.Errorf("%w: install xdotool (X11) or ydotool (Wayland)", ErrUnsupported)
}

func (d *linuxDesktop) SetVolume(v float64) error {
	pct := fmt.Sprintf("%d%%", int(v*100+0.5))
	switch {
	case has("wpctl"):
		return run("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", fmt.Sprintf("%.2f", v))
	case has("pactl"):
		return run("pactl", "set-sink-volume", "@DEFAULT_SINK@", pct)
	case has("amixer"):
		return run("amixer", "-q", "sset", "Master", pct)
	}
	return fmt.Errorf("%w: install wpctl, pactl or amixer", ErrUnsupported)
}

func (d *linuxDesktop) SetBrightness(v float64) error {
	pct := int(v*100 + 0.5)
	switch {
	case has("brightnessctl"):
		return run("brightnessctl", "set", fmt.Sprintf("%d%%", pct))
	case has("light"):
		return run("light", "-S", fmt.Sprintf("%d", pct))
	case !d.wayland && has("xrandr"):
		out, err := exec.Command("xrandr", "--current").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			var targetOutput string
			for _, line := range lines {
				if strings.Contains(line, " connected") {
					parts := strings.Fields(line)
					if len(parts) > 0 {
						if targetOutput == "" || strings.Contains(line, "primary") {
							targetOutput = parts[0]
							if strings.Contains(line, "primary") {
								break
							}
						}
					}
				}
			}
			if targetOutput != "" {
				return run("xrandr", "--output", targetOutput, "--brightness", fmt.Sprintf("%.2f", v))
			}
		}
	}
	return fmt.Errorf("%w: install brightnessctl, light or xrandr", ErrUnsupported)
}

func (d *linuxDesktop) ToggleMicMute() (string, error) {
	switch {
	case has("wpctl"):
		if err := run("wpctl", "set-mute", "@DEFAULT_AUDIO_SOURCE@", "toggle"); err != nil {
			return "", err
		}
		out, err := exec.Command("wpctl", "get-volume", "@DEFAULT_AUDIO_SOURCE@").Output()
		if err == nil && strings.Contains(string(out), "[MUTED]") {
			return "muted", nil
		}
		return "unmuted", nil
	case has("pactl"):
		if err := run("pactl", "set-source-mute", "@DEFAULT_SOURCE@", "toggle"); err != nil {
			return "", err
		}
		out, err := exec.Command("pactl", "get-source-mute", "@DEFAULT_SOURCE@").Output()
		if err == nil {
			if strings.Contains(strings.ToLower(string(out)), "yes") {
				return "muted", nil
			}
			return "unmuted", nil
		}
		return "toggled", nil
	case has("amixer"):
		out, err := exec.Command("amixer", "sset", "Capture", "toggle").CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("amixer: %v: %s", err, strings.TrimSpace(string(out)))
		}
		s := string(out)
		if strings.Contains(s, "[off]") {
			return "muted", nil
		}
		if strings.Contains(s, "[on]") {
			return "unmuted", nil
		}
		return "toggled", nil
	}
	return "", fmt.Errorf("%w: install wpctl, pactl or amixer", ErrUnsupported)
}

func (d *linuxDesktop) Power(kind string) error {
	switch kind {
	case "suspend":
		return run("systemctl", "suspend")
	case "restart":
		return run("systemctl", "reboot")
	case "shutdown":
		return run("systemctl", "poweroff")
	default:
		return fmt.Errorf("unknown power action %q", kind)
	}
}

func (d *linuxDesktop) OpenApp(argv []string) error {
	return openProcess(argv)
}

func (d *linuxDesktop) FocusWindow(app CallApp) error {
	switch {
	case os.Getenv("HYPRLAND_INSTANCE_SIGNATURE") != "" && has("hyprctl"):
		return run("hyprctl", "dispatch", "focuswindow", "title:(?i).*"+app.Title+".*")
	case os.Getenv("SWAYSOCK") != "" && has("swaymsg"):
		return run("swaymsg", fmt.Sprintf(`[title="(?i)%s"] focus`, app.Title))
	case !d.wayland && has("xdotool"):
		return run("xdotool", "search", "--onlyvisible", "--name", "(?i)"+app.Title, "windowactivate")
	}
	return ErrUnsupported
}
