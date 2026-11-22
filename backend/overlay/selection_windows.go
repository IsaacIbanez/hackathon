//go:build windows

package overlay

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	procSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	procIsWindow                   = user32.NewProc("IsWindow")
	procGetClipboardSequenceNumber = user32.NewProc("GetClipboardSequenceNumber")
	procOpenClipboard              = user32.NewProc("OpenClipboard")
	procCloseClipboard             = user32.NewProc("CloseClipboard")
	procEmptyClipboard             = user32.NewProc("EmptyClipboard")
	procGetClipboardData           = user32.NewProc("GetClipboardData")
	procSetClipboardData           = user32.NewProc("SetClipboardData")
	procKeybdEvent                 = user32.NewProc("keybd_event")
	procMapVirtualKey              = user32.NewProc("MapVirtualKeyW")
	procGetCursorPos               = user32.NewProc("GetCursorPos")
	procGetAsyncKeyState           = user32.NewProc("GetAsyncKeyState")
	procGlobalAlloc                = kernel32.NewProc("GlobalAlloc")
	procGlobalFree                 = kernel32.NewProc("GlobalFree")
	procGlobalLock                 = kernel32.NewProc("GlobalLock")
	procGlobalUnlock               = kernel32.NewProc("GlobalUnlock")
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
	keyUp         = 0x0002
	vkControl     = 0x11
	vkShift       = 0x10
	vkMenu        = 0x12 // Alt
	vkLWin        = 0x5B
	vkRWin        = 0x5C
	vkC           = 0x43
)

var (
	targetMu sync.Mutex
	target   uintptr // the other program's window that was in front when the overlay opened
)

// RememberTarget stores the window in front, unless it is the overlay itself. Call it when the
// shortcut is pressed, before the overlay takes the focus.
func RememberTarget() {
	h, _, _ := procGetForegroundWindow.Call()
	if h == 0 || ForegroundIsOurs() {
		return
	}
	targetMu.Lock()
	target = h
	targetMu.Unlock()
}

// CopySelection copies the selected text of the target window: the window in front if it is
// another program's, otherwise the one remembered by RememberTarget. The clipboard keeps the copied
// text (the caller replaces it, for example with the summary).
func CopySelection() (string, error) {
	h, _, _ := procGetForegroundWindow.Call()
	if h == 0 || ForegroundIsOurs() {
		targetMu.Lock()
		h = target
		targetMu.Unlock()
		if h == 0 {
			return "", ErrNoTarget
		}
		if ok, _, _ := procIsWindow.Call(h); ok == 0 {
			return "", ErrNoTarget
		}
		procSetForegroundWindow.Call(h)
		time.Sleep(150 * time.Millisecond) // let the program take the focus before Ctrl+C
	}
	before, _, _ := procGetClipboardSequenceNumber.Call()
	sendCtrlC()
	deadline := time.Now().Add(900 * time.Millisecond)
	for time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
		if now, _, _ := procGetClipboardSequenceNumber.Call(); now != before {
			time.Sleep(30 * time.Millisecond) // some programs write several formats in a row
			text, ok := ClipboardText()
			if !ok || text == "" {
				return "", ErrNoSelection
			}
			return text, nil
		}
	}
	return "", ErrNoSelection
}

func key(vk uintptr, flags uintptr) {
	scan, _, _ := procMapVirtualKey.Call(vk, 0)
	procKeybdEvent.Call(vk, scan, flags, 0)
}

// sendCtrlC releases Shift, Alt and Win if they are still held (Ctrl+Shift+C or Alt+C mean other
// things) and presses Ctrl+C. Only keys that are really down are released: a lone Alt release
// opens the menu bar of many programs (in Notepad, Ctrl+C then opened the File dialog).
func sendCtrlC() {
	for _, vk := range []uintptr{vkShift, vkMenu, vkLWin, vkRWin} {
		if s, _, _ := procGetAsyncKeyState.Call(vk); s&0x8000 != 0 {
			key(vk, keyUp)
		}
	}
	key(vkControl, 0)
	key(vkC, 0)
	key(vkC, keyUp)
	key(vkControl, keyUp)
}

func openClipboard() bool {
	for i := 0; i < 10; i++ { // another program may hold it for a moment
		if ok, _, _ := procOpenClipboard.Call(0); ok != 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// ClipboardText returns the clipboard's text (false if there is none or it can't be opened).
func ClipboardText() (string, bool) {
	if !openClipboard() {
		return "", false
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		return "", false
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return "", false
	}
	defer procGlobalUnlock.Call(h)
	base := memory(p)
	var units []uint16
	for i := 0; ; i++ {
		u := *(*uint16)(unsafe.Add(base, 2*i))
		if u == 0 {
			break
		}
		units = append(units, u)
	}
	return string(utf16.Decode(units)), true
}

// SetClipboardText replaces the clipboard with the text.
func SetClipboardText(s string) error {
	units := utf16.Encode([]rune(s + "\x00"))
	size := uintptr(len(units) * 2)
	if !openClipboard() {
		return errors.New("clipboard busy")
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()
	h, _, _ := procGlobalAlloc.Call(gmemMoveable, size)
	if h == 0 {
		return errors.New("clipboard: out of memory")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		procGlobalFree.Call(h)
		return errors.New("clipboard: lock failed")
	}
	copy(unsafe.Slice((*uint16)(memory(p)), len(units)), units)
	procGlobalUnlock.Call(h)
	if r, _, _ := procSetClipboardData.Call(cfUnicodeText, h); r == 0 {
		procGlobalFree.Call(h)
		return errors.New("clipboard: could not set the text")
	}
	return nil // the clipboard owns the memory now
}

// memory turns the address of a locked global memory block (GlobalLock) into a pointer.
func memory(addr uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&addr))
}

// CursorPos is the mouse position in screen pixels.
func CursorPos() (x, y int, ok bool) {
	var pt struct{ X, Y int32 }
	r, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	return int(pt.X), int(pt.Y), r != 0
}

var (
	procEnumWindows         = user32.NewProc("EnumWindows")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procGetWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procMonitorFromPoint    = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	procGetDpiForWindow     = user32.NewProc("GetDpiForWindow")
)

type rect struct{ Left, Top, Right, Bottom int32 }

// ourWindow is this app's main window (visible, with a title).
func ourWindow() uintptr {
	var found uintptr
	cb := syscall.NewCallback(func(h, _ uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
		if int(pid) != os.Getpid() {
			return 1
		}
		if v, _, _ := procIsWindowVisible.Call(h); v == 0 {
			return 1
		}
		if n, _, _ := procGetWindowTextLength.Call(h); n == 0 {
			return 1
		}
		found = h
		return 0 // stop
	})
	procEnumWindows.Call(cb, 0)
	return found
}

// PlaceNearCursor resizes this app's window to width×height (logical pixels, scaled with the
// display) and moves it next to the mouse pointer (below and to the right, or on the other side
// when it would leave the screen), on top. One SetWindowPos for both, so nothing moves it after.
func PlaceNearCursor(width, height int) (string, bool) {
	h := ourWindow()
	x, y, ok := CursorPos()
	if h == 0 || !ok {
		return fmt.Sprintf("no window (%#x) or no cursor", h), false
	}
	dpi := 96
	if procGetDpiForWindow.Find() == nil {
		if d, _, _ := procGetDpiForWindow.Call(h); d != 0 {
			dpi = int(d)
		}
	}
	w, ht := width*dpi/96, height*dpi/96
	mon, _, _ := procMonitorFromPoint.Call(uintptr(uint32(int32(x)))|uintptr(uint32(int32(y)))<<32, 2) // MONITOR_DEFAULTTONEAREST
	info := struct {
		Size          uint32
		Monitor, Work rect
		Flags         uint32
	}{Size: 40}
	procGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&info)))
	work := info.Work
	const gap = 18
	px, py := x+gap, y+gap
	if px+w > int(work.Right) {
		px = x - w - gap
	}
	if py+ht > int(work.Bottom) {
		py = y - ht - gap
	}
	px = max(int(work.Left), min(px, int(work.Right)-w))
	py = max(int(work.Top), min(py, int(work.Bottom)-ht))
	const hwndTopmost = ^uintptr(0) // (HWND)-1
	r, _, _ := procSetWindowPos.Call(h, hwndTopmost, uintptr(px), uintptr(py), uintptr(w), uintptr(ht), 0)
	return fmt.Sprintf("hwnd=%#x cursor=%d,%d dpi=%d work=%v -> %d,%d %dx%d ok=%d", h, x, y, dpi, work, px, py, w, ht, r), true
}

// FocusTarget gives the focus back to the program the selection came from.
func FocusTarget() {
	targetMu.Lock()
	h := target
	targetMu.Unlock()
	if h != 0 {
		if ok, _, _ := procIsWindow.Call(h); ok != 0 {
			procSetForegroundWindow.Call(h)
		}
	}
}
