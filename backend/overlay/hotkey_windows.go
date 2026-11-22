//go:build windows

package overlay

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procPostThreadMsg    = user32.NewProc("PostThreadMessageW")
	procGetThreadID      = kernel32.NewProc("GetCurrentThreadId")
)

const (
	modAlt      = 0x0001
	modControl  = 0x0002
	modShift    = 0x0004
	modWin      = 0x0008
	modNoRepeat = 0x4000
	wmHotkey    = 0x0312
	wmQuit      = 0x0012
	hotkeyID    = 0x4C48 // "LH"
)

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

// Listen registers the hotkey system-wide and calls onPress from its own goroutine every time it
// is pressed, in any program. It returns once the hotkey is registered (or failed: another program
// may own the combination). stop unregisters it.
func Listen(h Hotkey, onPress func()) (stop func(), err error) {
	stop, errs := ListenAll([]Hotkey{h}, func(int) { onPress() })
	if errs[0] != nil {
		stop()
		return func() {}, errs[0]
	}
	return stop, nil
}

func modifiers(h Hotkey) uintptr {
	mods := uintptr(modNoRepeat)
	if h.Alt {
		mods |= modAlt
	}
	if h.Ctrl {
		mods |= modControl
	}
	if h.Shift {
		mods |= modShift
	}
	if h.Win {
		mods |= modWin
	}
	return mods
}

// ListenAll registers several hotkeys system-wide on one thread and calls onPress(i) with the index
// of the one pressed. errs[i] is non-nil for each hotkey that could not be registered (another
// program may own it); the others still work. stop unregisters them all.
func ListenAll(keys []Hotkey, onPress func(i int)) (stop func(), errs []error) {
	errs = make([]error, len(keys))
	ready := make(chan struct{})
	var threadID uintptr
	go func() {
		// RegisterHotKey posts WM_HOTKEY to the thread that registered it: keep this goroutine on it.
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		threadID, _, _ = procGetThreadID.Call()
		for i, h := range keys {
			ok, _, e := procRegisterHotKey.Call(0, uintptr(hotkeyID+i), modifiers(h), uintptr(h.Key))
			if ok == 0 {
				errs[i] = fmt.Errorf("could not register %s (is another program using it?): %v", h, e)
				continue
			}
			defer procUnregisterHotKey.Call(0, uintptr(hotkeyID+i))
		}
		close(ready)
		var m msg
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 { // WM_QUIT or error
				return
			}
			if i := int(m.wParam) - hotkeyID; m.message == wmHotkey && i >= 0 && i < len(keys) {
				onPress(i)
			}
		}
	}()
	<-ready
	return func() { procPostThreadMsg.Call(threadID, wmQuit, 0, 0) }, errs
}

var (
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
)

// ForegroundIsOurs says whether the active window belongs to this process. The shortcut uses it:
// if the overlay is open but covered (by Gesture Control's window, for example), it comes to the
// front instead of hiding.
func ForegroundIsOurs() bool {
	h, _, _ := procGetForegroundWindow.Call()
	if h == 0 {
		return false
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
	return int(pid) == os.Getpid()
}

var procSetForegroundWindow = user32.NewProc("SetForegroundWindow")

// OtherForeground returns the active window when it belongs to another program (0 if it is ours
// or there is none), to give it the focus back later with RestoreForeground.
func OtherForeground() uintptr {
	if ForegroundIsOurs() {
		return 0
	}
	h, _, _ := procGetForegroundWindow.Call()
	return h
}

// RestoreForeground gives the focus back to a window saved with OtherForeground.
func RestoreForeground(h uintptr) {
	if h != 0 {
		procSetForegroundWindow.Call(h)
	}
}
