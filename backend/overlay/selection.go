package overlay

import "errors"

// Selected text from any program (overlay option "Summarize the selected text", docs/OVERLAY.md).
//
// The person selects text in another program and then opens the overlay, which takes the focus.
// So the app keeps remembering the last other program's window that was in front (WatchTarget,
// plus RememberTarget on the shortcut and the keypad): the overlay may have been opened by any
// means (at startup, by clicking the camera bubble, from the fist menu). To read the selection the
// overlay gives that window the focus back, sends Ctrl+C and reads the clipboard (CopySelection).
// A later trigger without the overlay in front (the hand cursor of Gesture Control) works the same:
// the window in front is the target.

// shellClasses are window classes that can be in front but never hold the person's selection:
// the taskbar (also on a second screen), the desktop and the task switcher. They are never
// remembered as the target, so clicking the taskbar on the way to the overlay keeps the program
// the text was selected in.
var shellClasses = map[string]bool{
	"Shell_TrayWnd":                       true,
	"Shell_SecondaryTrayWnd":              true,
	"Progman":                             true,
	"WorkerW":                             true,
	"MultitaskingViewFrame":               true,
	"XamlExplorerHostIslandWindow":        true, // Windows 11 Alt+Tab
	"Windows.UI.Core.CoreWindow":          true, // Start menu and search (Store apps use ApplicationFrameWindow)
	"ControlCenterWindow":                 true, // Windows 11 quick settings
	"NotifyIconOverflowWindow":            true, // hidden tray icons
	"TopLevelWindowForOverflowXamlIsland": true,
	"Shell_InputSwitchTopLevelWindow":     true, // keyboard language switcher
}

// isShellWindowClass reports whether a window of this class should never be the target.
func isShellWindowClass(class string) bool {
	return class == "" || shellClasses[class]
}

var (
	// ErrNoTarget: there is no other program's window to copy from.
	ErrNoTarget = errors.New("no window to copy the selection from")
	// ErrNoSelection: Ctrl+C did not change the clipboard (nothing selected, or the program
	// does not copy with Ctrl+C).
	ErrNoSelection = errors.New("no text selected")
)
