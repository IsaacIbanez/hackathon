//go:build !windows

package overlay

// ListenKeypad is only implemented on Windows (the demo machine): elsewhere the keypad is not read.
func ListenKeypad(_ func(n int), _ func(connected bool)) (stop func()) { return func() {} }
