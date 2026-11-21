package control

import (
	"fmt"
	"strings"
)

// Combo is a keyboard shortcut: zero or more modifiers plus one key.
type Combo struct {
	Mods []string // "ctrl", "shift", "alt", "meta" (Cmd on macOS, Win on Windows)
	Key  string   // a letter, a digit, or "enter", "escape", "tab", "space"
}

var modAliases = map[string]string{
	"ctrl": "ctrl", "control": "ctrl",
	"shift": "shift",
	"alt":   "alt", "option": "alt",
	"meta": "meta", "cmd": "meta", "super": "meta", "win": "meta",
}

var namedKeys = map[string]bool{"enter": true, "escape": true, "tab": true, "space": true}

// ParseCombo parses shortcuts such as "ctrl+shift+m" or "alt+q".
func ParseCombo(s string) (Combo, error) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(s)), "+")
	if len(parts) == 0 || parts[len(parts)-1] == "" {
		return Combo{}, fmt.Errorf("empty shortcut %q", s)
	}
	var c Combo
	for _, p := range parts[:len(parts)-1] {
		m, ok := modAliases[p]
		if !ok {
			return Combo{}, fmt.Errorf("unknown modifier %q in %q", p, s)
		}
		c.Mods = append(c.Mods, m)
	}
	key := parts[len(parts)-1]
	isChar := len(key) == 1 && ((key[0] >= 'a' && key[0] <= 'z') || (key[0] >= '0' && key[0] <= '9'))
	if !isChar && !namedKeys[key] {
		return Combo{}, fmt.Errorf("unknown key %q in %q", key, s)
	}
	c.Key = key
	return c, nil
}

// MustCombo is ParseCombo for shortcuts defined in code.
func MustCombo(s string) Combo {
	c, err := ParseCombo(s)
	if err != nil {
		panic(err)
	}
	return c
}

func (c Combo) String() string {
	return strings.Join(append(append([]string{}, c.Mods...), c.Key), "+")
}

func (c Combo) Has(mod string) bool {
	for _, m := range c.Mods {
		if m == mod {
			return true
		}
	}
	return false
}
