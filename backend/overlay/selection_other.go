//go:build !windows

package overlay

import "errors"

var errNotWindows = errors.New("reading the selection of other programs is only implemented on Windows")

func RememberTarget()                         {}
func CopySelection() (string, error)          { return "", errNotWindows }
func DeleteSelection() (int, error)           { return 0, errNotWindows }
func ClipboardText() (string, bool)           { return "", false }
func SetClipboardText(string) error           { return errNotWindows }
func CursorPos() (x, y int, ok bool)          { return 0, 0, false }
func PlaceNearCursor(int, int) (string, bool) { return "", false }
func FocusTarget()                            {}
