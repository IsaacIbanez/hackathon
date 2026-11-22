// Package overlay holds what turns the desktop app into an overlay: a system-wide shortcut that
// shows it from any program (Ctrl+Alt+Space by default; an MX Keypad key can be mapped to the same
// shortcut in Logi Options+) and the helper processes some options need (the reading service in
// Python and Gesture Control). See docs/OVERLAY.md.
package overlay

import (
	"fmt"
	"os"
	"strings"
)

// DefaultHotkey opens the overlay. Override it with LAUZHACK_HOTKEY (for example "ctrl+shift+l").
const DefaultHotkey = "ctrl+alt+space"

// Hotkey is a key combination: modifier flags plus a Windows virtual-key code.
type Hotkey struct {
	Ctrl, Alt, Shift, Win bool
	Key                   uint32 // Windows virtual-key code
	Text                  string // as the user wrote it, normalized ("ctrl+alt+space")
}

func (h Hotkey) String() string { return h.Text }

// HotkeyFromEnv returns LAUZHACK_HOTKEY parsed, or DefaultHotkey.
func HotkeyFromEnv() (Hotkey, error) {
	s := os.Getenv("LAUZHACK_HOTKEY")
	if strings.TrimSpace(s) == "" {
		s = DefaultHotkey
	}
	return ParseHotkey(s)
}

// Named keys besides letters, digits and F1–F24.
var namedKeys = map[string]uint32{
	"space": 0x20, "enter": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B,
	"insert": 0x2D, "delete": 0x2E, "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
	"pause": 0x13, "scrolllock": 0x91,
	"num0": 0x60, "num1": 0x61, "num2": 0x62, "num3": 0x63, "num4": 0x64,
	"num5": 0x65, "num6": 0x66, "num7": 0x67, "num8": 0x68, "num9": 0x69,
}

// ParseHotkey reads combinations such as "ctrl+alt+space", "ctrl+shift+l" or "f13".
// A single key without modifiers is accepted only for F13–F24 (keys a normal keyboard lacks,
// handy for a hardware keypad): any other bare key would steal normal typing.
func ParseHotkey(s string) (Hotkey, error) {
	var h Hotkey
	parts := strings.Split(strings.ToLower(strings.ReplaceAll(s, " ", "")), "+")
	var names []string
	for i, p := range parts {
		last := i == len(parts)-1
		switch {
		case p == "ctrl" || p == "control":
			h.Ctrl = true
		case p == "alt":
			h.Alt = true
		case p == "shift":
			h.Shift = true
		case p == "win" || p == "super" || p == "meta":
			h.Win = true
		case last:
			k, ok := keyCode(p)
			if !ok {
				return Hotkey{}, fmt.Errorf("hotkey %q: unknown key %q", s, p)
			}
			h.Key = k
		default:
			return Hotkey{}, fmt.Errorf("hotkey %q: %q must be a modifier (ctrl, alt, shift, win)", s, p)
		}
		names = append(names, p)
	}
	if h.Key == 0 {
		return Hotkey{}, fmt.Errorf("hotkey %q: no key after the modifiers", s)
	}
	if !h.Ctrl && !h.Alt && !h.Shift && !h.Win && (h.Key < 0x7C || h.Key > 0x87) {
		return Hotkey{}, fmt.Errorf("hotkey %q: a key alone is only allowed for F13–F24", s)
	}
	h.Text = strings.Join(names, "+")
	return h, nil
}

func keyCode(p string) (uint32, bool) {
	if k, ok := namedKeys[p]; ok {
		return k, true
	}
	if len(p) == 1 && (p[0] >= 'a' && p[0] <= 'z' || p[0] >= '0' && p[0] <= '9') {
		return uint32(strings.ToUpper(p)[0]), true
	}
	var n int
	if _, err := fmt.Sscanf(p, "f%d", &n); err == nil && n >= 1 && n <= 24 && p == fmt.Sprintf("f%d", n) {
		return uint32(0x70 + n - 1), true
	}
	return 0, false
}
