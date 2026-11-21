package overlay

import "testing"

func TestParseHotkey(t *testing.T) {
	cases := []struct {
		in   string
		want Hotkey
	}{
		{"ctrl+alt+space", Hotkey{Ctrl: true, Alt: true, Key: 0x20, Text: "ctrl+alt+space"}},
		{"Ctrl + Shift + L", Hotkey{Ctrl: true, Shift: true, Key: 'L', Text: "ctrl+shift+l"}},
		{"f13", Hotkey{Key: 0x7C, Text: "f13"}},
		{"win+alt+num5", Hotkey{Win: true, Alt: true, Key: 0x65, Text: "win+alt+num5"}},
		{"ctrl+f1", Hotkey{Ctrl: true, Key: 0x70, Text: "ctrl+f1"}},
	}
	for _, c := range cases {
		got, err := ParseHotkey(c.in)
		if err != nil || got != c.want {
			t.Errorf("ParseHotkey(%q) = %+v, %v; want %+v", c.in, got, err, c.want)
		}
	}
	for _, bad := range []string{"", "space", "ctrl+alt", "ctrl+banana", "l+ctrl", "f25", "f1"} {
		if _, err := ParseHotkey(bad); err == nil {
			t.Errorf("ParseHotkey(%q): want an error", bad)
		}
	}
}

func TestHotkeyFromEnv(t *testing.T) {
	t.Setenv("LAUZHACK_HOTKEY", "")
	if h, err := HotkeyFromEnv(); err != nil || h.String() != DefaultHotkey {
		t.Fatalf("default: %v %v", h, err)
	}
	t.Setenv("LAUZHACK_HOTKEY", "ctrl+shift+l")
	if h, err := HotkeyFromEnv(); err != nil || h.String() != "ctrl+shift+l" {
		t.Fatalf("env: %v %v", h, err)
	}
}

func TestReadingServiceURL(t *testing.T) {
	for in, want := range map[string]string{
		"":                            "http://127.0.0.1:8770",
		"fixture":                     "http://127.0.0.1:8770",
		"http://127.0.0.1:9000/scan":  "http://127.0.0.1:9000",
		"http://127.0.0.1:9000/scan/": "http://127.0.0.1:9000",
	} {
		t.Setenv("SCANNER_URL", in)
		if got := ReadingServiceURL(); got != want {
			t.Errorf("SCANNER_URL=%q: %q, want %q", in, got, want)
		}
	}
}
