package overlay

import (
	"fmt"
	"os"
	"strings"
)

// The MX Keypad (docs/KEYPAD.md, brief docs/briefs/N2.md) is set up in Logi Options+ so that each
// key sends one of these system-wide shortcuts. They work while another program has the focus:
// the app shows the overlay and does the action. Ctrl+Alt+Shift is used because almost no program
// takes it.

// KeypadAction is what a keypad key asks the overlay to do. The UI translates it
// (web/src/app/overlay/keypad.ts).
type KeypadAction string

const (
	KeypadToggle   KeypadAction = "toggle"    // show or hide the overlay (like Ctrl+Alt+Space)
	KeypadGestures KeypadAction = "gestures"  // option 1
	KeypadDocument KeypadAction = "documents" // option 2: read a paper document
	KeypadReadFile KeypadAction = "read-file" // option 3: read a file aloud
	KeypadMenu     KeypadAction = "menu"      // back to the menu
	KeypadPlay     KeypadAction = "play"      // read / pause
	KeypadPrevious KeypadAction = "previous"
	KeypadNext     KeypadAction = "next"
	KeypadRepeat   KeypadAction = "repeat"
)

// KeypadBinding is one keypad key: the shortcut it sends and what it does.
type KeypadBinding struct {
	Hotkey Hotkey
	Action KeypadAction
}

// DefaultKeypad is page 1 of the keypad, in key order.
var DefaultKeypad = []struct {
	Shortcut string
	Action   KeypadAction
}{
	{"ctrl+alt+shift+o", KeypadToggle},
	{"ctrl+alt+shift+1", KeypadGestures},
	{"ctrl+alt+shift+2", KeypadDocument},
	{"ctrl+alt+shift+3", KeypadReadFile},
	{"ctrl+alt+shift+b", KeypadMenu},
	{"ctrl+alt+shift+p", KeypadPlay},
	{"ctrl+alt+shift+left", KeypadPrevious},
	{"ctrl+alt+shift+right", KeypadNext},
	{"ctrl+alt+shift+r", KeypadRepeat},
}

// KeypadFromEnv returns the keypad shortcuts, or none when LAUZHACK_KEYPAD=off.
func KeypadFromEnv() ([]KeypadBinding, error) {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LAUZHACK_KEYPAD")), "off") {
		return nil, nil
	}
	out := make([]KeypadBinding, 0, len(DefaultKeypad))
	for _, k := range DefaultKeypad {
		h, err := ParseHotkey(k.Shortcut)
		if err != nil {
			return nil, fmt.Errorf("keypad %s: %w", k.Action, err)
		}
		out = append(out, KeypadBinding{Hotkey: h, Action: k.Action})
	}
	return out, nil
}
