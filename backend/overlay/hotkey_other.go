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

// PlaceInCorner is only implemented on Windows (the caller falls back to Wails' positioning).
func PlaceInCorner(string, bool, int) bool { return false }

// ListenAll is only implemented on Windows: every hotkey fails.
func ListenAll(keys []Hotkey, _ func(int)) (stop func(), errs []error) {
	errs = make([]error, len(keys))
	for i, h := range keys {
		_, errs[i] = Listen(h, nil)
	}
	return func() {}, errs
}
