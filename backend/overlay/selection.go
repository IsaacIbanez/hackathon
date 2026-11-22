package overlay

import "errors"

// Selected text from any program (overlay option "Summarize the selected text", docs/OVERLAY.md).
//
// The person selects text in another program and then opens the overlay, which takes the focus.
// So the shortcut remembers which window was in front (RememberTarget); to read the selection the
// overlay gives that window the focus back, sends Ctrl+C and reads the clipboard (CopySelection).
// A later trigger without the overlay in front (the hand cursor of Gesture Control) works the same:
// the window in front is the target.

var (
	// ErrNoTarget: there is no other program's window to copy from.
	ErrNoTarget = errors.New("no window to copy the selection from")
	// ErrNoSelection: Ctrl+C did not change the clipboard (nothing selected, or the program
	// does not copy with Ctrl+C).
	ErrNoSelection = errors.New("no text selected")
)
