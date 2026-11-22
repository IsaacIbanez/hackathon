//go:build !windows

package overlay

import (
	"errors"
	"runtime"
)

// ForegroundIsOurs is only known on Windows.
func ForegroundIsOurs() bool { return true }

// Listen is only implemented on Windows (the demo machine). Elsewhere the overlay stays open as a
// normal window; Linux and macOS would need their own implementation (X11 / Carbon).
func Listen(h Hotkey, _ func()) (stop func(), err error) {
	return func() {}, errors.New("system-wide hotkey not implemented on " + runtime.GOOS + ": " + h.String())
}

// OtherForeground is only known on Windows.
func OtherForeground() uintptr { return 0 }

// RestoreForeground is only implemented on Windows.
func RestoreForeground(uintptr) {}
