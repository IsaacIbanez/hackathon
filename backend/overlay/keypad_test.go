package overlay

import "testing"

func TestKeypadFromEnv(t *testing.T) {
	t.Setenv("LAUZHACK_KEYPAD", "")
	keys, err := KeypadFromEnv()
	if err != nil || len(keys) != 9 {
		t.Fatalf("default keypad: %d keys, %v", len(keys), err)
	}
	seen := map[string]bool{}
	actions := map[KeypadAction]bool{}
	for _, k := range keys {
		h := k.Hotkey
		if !h.Ctrl || !h.Alt || !h.Shift || h.Win {
			t.Errorf("%s: want ctrl+alt+shift, got %s", k.Action, h)
		}
		if seen[h.Text] || actions[k.Action] {
			t.Errorf("duplicate shortcut or action: %s %s", h, k.Action)
		}
		seen[h.Text], actions[k.Action] = true, true
		if def, _ := ParseHotkey(DefaultHotkey); h == def {
			t.Errorf("%s reuses the overlay shortcut", k.Action)
		}
	}
	for i, k := range keys {
		if k.Hotkey.Key != uint32('1'+i) {
			t.Errorf("key %d: fallback must be ctrl+alt+shift+%d, got %s", i+1, i+1, k.Hotkey)
		}
	}
	if keys[0].Action != KeypadToggle || keys[1].Action != KeypadRecord || keys[2].Action != KeypadStopRec {
		t.Errorf("keys 1-3 must open the app and start/stop recording: %+v", keys[:3])
	}

	t.Setenv("LAUZHACK_KEYPAD", "Off")
	if keys, err := KeypadFromEnv(); err != nil || len(keys) != 0 {
		t.Errorf("off: %v %v", keys, err)
	}
}

func TestParseArrowKeys(t *testing.T) {
	for in, want := range map[string]uint32{"ctrl+left": 0x25, "ctrl+up": 0x26, "ctrl+right": 0x27, "ctrl+down": 0x28} {
		if h, err := ParseHotkey(in); err != nil || h.Key != want {
			t.Errorf("%s: %+v %v", in, h, err)
		}
	}
}
