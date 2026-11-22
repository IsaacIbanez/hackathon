//go:build !windows

package overlay

import "errors"

// StepVolume is only implemented on Windows.
func StepVolume(bool) error {
	return errors.New("changing the system volume by voice is only implemented on Windows")
}
