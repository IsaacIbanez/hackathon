//go:build !windows

package overlay

// AnotherInstance is only checked on Windows (the demo machine).
func AnotherInstance() bool { return false }
