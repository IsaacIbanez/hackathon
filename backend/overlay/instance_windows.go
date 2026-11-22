//go:build windows

package overlay

import (
	"syscall"
	"unsafe"
)

var procCreateMutex = kernel32.NewProc("CreateMutexW")

// instanceMutex stays open for the life of the process: Windows frees it when the app exits.
var instanceMutex uintptr

// AnotherInstance says whether another copy of the app is already running (R4): two copies fight
// over the shortcuts, the keypad and the camera, and the user may be looking at an old build.
// The first call claims the name; later copies see it taken.
func AnotherInstance() bool {
	if instanceMutex != 0 {
		return false
	}
	name, _ := syscall.UTF16PtrFromString(`Local\LauzHackOverlay`)
	h, _, err := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	instanceMutex = h
	const errorAlreadyExists = 183
	return h != 0 && err == syscall.Errno(errorAlreadyExists)
}
