//go:build !windows

package overlay

import "errors"

// MicMuted is only implemented on Windows.
func MicMuted() (bool, error) {
	return false, errors.New("reading the microphone state is only implemented on Windows")
}
