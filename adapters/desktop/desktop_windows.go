//go:build windows

package main

import (
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// windowsDesktop calls the Windows API (user32.dll) directly: no extra tools needed.
type windowsDesktop struct{}

func newDesktop(_, _ int) Desktop { return windowsDesktop{} }

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procKeybdEvent       = user32.NewProc("keybd_event")
	procMouseEvent       = user32.NewProc("mouse_event")
	procSetCursorPos     = user32.NewProc("SetCursorPos")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
	procEnumWindows      = user32.NewProc("EnumWindows")
	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procIsWindowVisible  = user32.NewProc("IsWindowVisible")
	procSetForeground    = user32.NewProc("SetForegroundWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
	procIsIconic         = user32.NewProc("IsIconic")
)

const (
	keyeventfKeyUp = 0x0002
	mouseLeftDown  = 0x0002
	mouseLeftUp    = 0x0004
	vkVolumeDown   = 0xAE
	vkVolumeUp     = 0xAF
	vkMenu         = 0x12 // Alt
	swRestore      = 9
	smCxScreen     = 0
	smCyScreen     = 1
)

var winMods = map[string]uintptr{"ctrl": 0x11, "shift": 0x10, "alt": 0x12, "meta": 0x5B}
var winKeys = map[string]uintptr{"enter": 0x0D, "escape": 0x1B, "tab": 0x09, "space": 0x20}

func (windowsDesktop) Name() string { return "Windows (user32)" }

func key(vk uintptr, up bool) {
	var flags uintptr
	if up {
		flags = keyeventfKeyUp
	}
	procKeybdEvent.Call(vk, 0, flags, 0)
}

func vkFor(k string) uintptr {
	if v, ok := winKeys[k]; ok {
		return v
	}
	return uintptr(strings.ToUpper(k)[0]) // 'A'..'Z' and '0'..'9' are their ASCII codes
}

func (windowsDesktop) PressKeys(c Combo) error {
	for _, m := range c.Mods {
		key(winMods[m], false)
	}
	vk := vkFor(c.Key)
	key(vk, false)
	key(vk, true)
	for i := len(c.Mods) - 1; i >= 0; i-- {
		key(winMods[c.Mods[i]], true)
	}
	return nil
}

func (windowsDesktop) MoveMouse(x, y float64) error {
	w, _, _ := procGetSystemMetrics.Call(smCxScreen)
	h, _, _ := procGetSystemMetrics.Call(smCyScreen)
	px, py := screenPixels(x, y, int(w), int(h))
	procSetCursorPos.Call(uintptr(px), uintptr(py))
	return nil
}

func (windowsDesktop) Click() error {
	procMouseEvent.Call(mouseLeftDown, 0, 0, 0, 0)
	procMouseEvent.Call(mouseLeftUp, 0, 0, 0, 0)
	return nil
}

// SetVolume has no simple absolute API without COM, so it presses "volume down" 50 times
// (to 0 %) and then "volume up" once per 2 %.
func (windowsDesktop) SetVolume(v float64) error {
	for i := 0; i < 50; i++ {
		key(vkVolumeDown, false)
		key(vkVolumeDown, true)
	}
	for i := 0; i < int(v*50+0.5); i++ {
		key(vkVolumeUp, false)
		key(vkVolumeUp, true)
	}
	return nil
}

func windowTitle(hwnd uintptr) string {
	buf := make([]uint16, 256)
	n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf[:n])
}

func (windowsDesktop) FocusWindow(app CallApp) error {
	needle := strings.ToLower(app.Title)
	var found uintptr
	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1
		}
		if strings.Contains(strings.ToLower(windowTitle(hwnd)), needle) {
			found = hwnd
			return 0 // stop
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	if found == 0 {
		return ErrUnsupported
	}
	if minimized, _, _ := procIsIconic.Call(found); minimized != 0 {
		procShowWindow.Call(found, swRestore)
	}
	// Windows only lets a process take the foreground after recent input: a tap on Alt allows it.
	key(vkMenu, false)
	key(vkMenu, true)
	procSetForeground.Call(found)
	time.Sleep(50 * time.Millisecond)
	return nil
}
