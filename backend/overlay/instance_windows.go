package overlay

import (
	"syscall"
	"unsafe"
)

var procCreateMutexW = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW")

const errorAlreadyExists = 183

// instanceMutex is held for the whole life of the app: a second copy finds it already exists.
var instanceMutex uintptr

// AnotherInstance says whether another copy of the app is already running (a named mutex per user
// session). Two copies fight for the keypad, the shortcuts, the camera and port 8765.
func AnotherInstance() bool {
	name, err := syscall.UTF16PtrFromString(`Local\LauzHackOverlay`)
	if err != nil {
		return false
	}
	h, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return false
	}
	instanceMutex = h
	if errno, ok := callErr.(syscall.Errno); ok && errno == errorAlreadyExists {
		return true
	}
	return false
}
