package main

// Keyboard shortcuts for the actions the gesture page can ask for, per platform and video-call app.

// CallApp is a video-call application the helper knows how to control.
type CallApp struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Title  string `json:"-"` // case-insensitive window-title pattern used to focus it
	MacApp string `json:"-"` // application name to activate on macOS
}

// CallApps lists the supported video-call apps; the first one is the default.
var CallApps = []CallApp{
	{ID: "meet", Name: "Google Meet", Title: "Meet", MacApp: "Google Chrome"},
	{ID: "zoom", Name: "Zoom", Title: "Zoom", MacApp: "zoom.us"},
	{ID: "teams", Name: "Microsoft Teams", Title: "Teams", MacApp: "Microsoft Teams"},
}

// FindCallApp returns the app with that id, or the default one when id is empty.
func FindCallApp(id string) (CallApp, bool) {
	if id == "" {
		return CallApps[0], true
	}
	for _, a := range CallApps {
		if a.ID == id {
			return a, true
		}
	}
	return CallApp{}, false
}

// CallActions are the actions that act on a video call (they need an app).
var CallActions = map[string]bool{"toggle_mic": true, "toggle_camera": true, "raise_hand": true, "leave_call": true}

// Shortcuts for actions that are the same in every app. "mod" is Ctrl, or Cmd on macOS.
var genericShortcuts = map[string][]string{
	"enter":        {"enter"},
	"escape":       {"escape"},
	"next_tab":     {"ctrl+tab"},
	"previous_tab": {"ctrl+shift+tab"},
	"undo":         {"mod+z"},
}

// Shortcuts per call app, for Windows/Linux ("pc") and macOS ("mac").
var callShortcuts = map[string]map[string]map[string][]string{
	"pc": {
		"meet":  {"toggle_mic": {"ctrl+d"}, "toggle_camera": {"ctrl+e"}, "raise_hand": {"ctrl+alt+h"}, "leave_call": {"ctrl+w"}},
		"zoom":  {"toggle_mic": {"alt+a"}, "toggle_camera": {"alt+v"}, "raise_hand": {"alt+y"}, "leave_call": {"alt+q", "enter"}},
		"teams": {"toggle_mic": {"ctrl+shift+m"}, "toggle_camera": {"ctrl+shift+o"}, "raise_hand": {"ctrl+shift+k"}, "leave_call": {"ctrl+shift+h"}},
	},
	"mac": {
		"meet":  {"toggle_mic": {"cmd+d"}, "toggle_camera": {"cmd+e"}, "raise_hand": {"cmd+ctrl+h"}, "leave_call": {"cmd+w"}},
		"zoom":  {"toggle_mic": {"cmd+shift+a"}, "toggle_camera": {"cmd+shift+v"}, "raise_hand": {"alt+y"}, "leave_call": {"cmd+w", "enter"}},
		"teams": {"toggle_mic": {"cmd+shift+m"}, "toggle_camera": {"cmd+shift+o"}, "raise_hand": {"cmd+shift+k"}, "leave_call": {"cmd+shift+h"}},
	},
}

// Shortcuts returns the key sequence for an action on a platform (runtime.GOOS), or false if the
// action is not a keyboard action.
func Shortcuts(action, appID, goos string) ([]Combo, bool) {
	class := "pc"
	mod := "ctrl"
	if goos == "darwin" {
		class, mod = "mac", "cmd"
	}
	var keys []string
	if CallActions[action] {
		app, ok := FindCallApp(appID)
		if !ok {
			return nil, false
		}
		keys = callShortcuts[class][app.ID][action]
	} else {
		keys = genericShortcuts[action]
	}
	if len(keys) == 0 {
		return nil, false
	}
	out := make([]Combo, 0, len(keys))
	for _, k := range keys {
		if len(k) > 4 && k[:4] == "mod+" {
			k = mod + k[3:]
		}
		out = append(out, MustCombo(k))
	}
	return out, true
}
