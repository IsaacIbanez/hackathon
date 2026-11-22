package overlay

import (
	"fmt"
	"os"
	"strings"
)

// The MX Keypad (docs/KEYPAD.md, brief docs/briefs/N2.md) is read directly over USB
// (keypadhid*.go): key n does row n of DefaultKeypad. Each row also has a system-wide fallback
// shortcut, Ctrl+Alt+Shift+n, for Logi Options+ or a normal keyboard. Both work while another
// program has the focus: the app shows the overlay and does the action.

// KeypadAction is what a keypad key asks the overlay to do. The UI translates it
// (web/src/app/overlay/keypad.ts).
type KeypadAction string

const (
	KeypadToggle     KeypadAction = "toggle"        // show or hide the overlay (like Ctrl+Alt+Space)
	KeypadGestures   KeypadAction = "gestures"      // option 1
	KeypadDocument   KeypadAction = "documents"     // option 2: read a paper document
	KeypadReadFile   KeypadAction = "read-file"     // option 3: read a file aloud
	KeypadSummary    KeypadAction = "summarize"     // option 4: summarize the selected text
	KeypadTranscribe KeypadAction = "transcribe"    // live captions of the microphone or a call
	KeypadRecord     KeypadAction = "record-start"  // start recording a voice command
	KeypadStopRec    KeypadAction = "record-stop"   // stop recording: transcribe it and do what it says
	KeypadRecToggle  KeypadAction = "record-toggle" // the same key starts recording, then stops it and does what it says
	KeypadMenu       KeypadAction = "menu"          // back to the menu
	KeypadPlay       KeypadAction = "play"          // read / pause
	KeypadPrevious   KeypadAction = "previous"
	KeypadNext       KeypadAction = "next"
	KeypadRepeat     KeypadAction = "repeat"
	KeypadOff        KeypadAction = "off" // the key does nothing (not decided yet)
)

// KeypadBinding is one keypad key: the shortcut it sends and what it does.
type KeypadBinding struct {
	Hotkey Hotkey
	Action KeypadAction
}

// DefaultKeypad is page 1 of the keypad, in key order (decided again by Isaac, key by key, on
// 2026-11-22: docs/KEYPAD.md). The fallback shortcut of key n is Ctrl+Alt+Shift+n. A key set to
// KeypadOff does nothing.
var DefaultKeypad = []struct {
	Shortcut string
	Action   KeypadAction
}{
	{"ctrl+alt+shift+1", KeypadToggle},
	{"ctrl+alt+shift+2", KeypadDocument},
	{"ctrl+alt+shift+3", KeypadReadFile},
	{"ctrl+alt+shift+4", KeypadSummary},
	{"ctrl+alt+shift+5", KeypadTranscribe},
	{"ctrl+alt+shift+6", KeypadGestures},
	{"ctrl+alt+shift+7", KeypadRecToggle},
	{"ctrl+alt+shift+8", KeypadPlay},
	{"ctrl+alt+shift+9", KeypadMenu},
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
