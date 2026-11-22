package overlay

import "testing"

func TestShellWindowsAreNeverTheTarget(t *testing.T) {
	for _, class := range []string{"", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW",
		"MultitaskingViewFrame", "XamlExplorerHostIslandWindow", "Windows.UI.Core.CoreWindow",
		"ControlCenterWindow", "NotifyIconOverflowWindow"} {
		if !isShellWindowClass(class) {
			t.Errorf("%q should not be remembered as the window to copy from", class)
		}
	}
	// Programs where people select text: Notepad, Chrome/Edge, Word, a Store app's frame.
	for _, class := range []string{"Notepad", "Chrome_WidgetWin_1", "OpusApp", "ApplicationFrameWindow"} {
		if isShellWindowClass(class) {
			t.Errorf("%q should be a valid window to copy from", class)
		}
	}
}
