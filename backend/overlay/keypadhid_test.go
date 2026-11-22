package overlay

import (
	"encoding/hex"
	"testing"
)

func TestKeypadKeyPressed(t *testing.T) {
	// Reports recorded from the real keypad (keys 1, 9 and a release).
	cases := map[string]int{
		"13ff0200c5010100000000000000000000000000000000000000000000000000": 1,
		"13ff0200c5010900000000000000000000000000000000000000000000000000": 9,
		"13ff0200c6010000000000000000000000000000000000000000000000000000": 0, // release
		"13ff0200c6010a00": 0, // no key 10
		"11ff0200c6010300": 0, // another report
		"13ff02":           0, // too short
	}
	for in, want := range cases {
		b, _ := hex.DecodeString(in)
		if got := KeypadKeyPressed(b); got != want {
			t.Errorf("%s: got %d, want %d", in, got, want)
		}
	}
}

func TestKeypadActionForKey(t *testing.T) {
	if a, ok := KeypadActionForKey(1); !ok || a != KeypadToggle {
		t.Errorf("key 1: %v %v", a, ok)
	}
	if a, ok := KeypadActionForKey(9); !ok || a != KeypadMenu {
		t.Errorf("key 9: %v %v", a, ok)
	}
	for _, n := range []int{0, 10, -1} {
		if _, ok := KeypadActionForKey(n); ok {
			t.Errorf("key %d: want no action", n)
		}
	}
}
