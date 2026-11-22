//go:build !windows

package overlay

// AnotherInstance is only implemented on Windows.
func AnotherInstance() bool { return false }
