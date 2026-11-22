//go:build windows

package control

import (
	"encoding/base64"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

// windowsDesktop calls the Windows API (user32.dll) directly: no extra tools needed.
type windowsDesktop struct{}

func NewDesktop(_, _ int) Desktop { return windowsDesktop{} }

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
	mouseRightDown = 0x0008
	mouseRightUp   = 0x0010
	mouseWheel     = 0x0800
	wheelDelta     = 120
	createNoWindow = 0x08000000
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

func (windowsDesktop) MouseDown() error {
	procMouseEvent.Call(mouseLeftDown, 0, 0, 0, 0)
	return nil
}

func (windowsDesktop) MouseUp() error {
	procMouseEvent.Call(mouseLeftUp, 0, 0, 0, 0)
	return nil
}

func (windowsDesktop) RightClick() error {
	procMouseEvent.Call(mouseRightDown, 0, 0, 0, 0)
	procMouseEvent.Call(mouseRightUp, 0, 0, 0, 0)
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

// hidden runs a console program without opening a console window: from the desktop app (which
// has no console) every PowerShell call would otherwise flash a window and take the focus.
func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func (windowsDesktop) Scroll(n int) error {
	procMouseEvent.Call(mouseWheel, 0, 0, uintptr(uint32(int32(n*wheelDelta))), 0)
	return nil
}

// OnScreenKeyboard opens osk.exe. It must go through the shell ("start"): osk asks for UI access,
// and starting it directly fails with "the requested operation requires elevation".
func (windowsDesktop) OnScreenKeyboard() error {
	return hidden(exec.Command("cmd.exe", "/c", "start", "", "osk.exe")).Run()
}

func runPowerShell(script string) (string, error) {
	utf16Runes := utf16.Encode([]rune(script))
	b := make([]byte, len(utf16Runes)*2)
	for i, v := range utf16Runes {
		b[i*2] = byte(v)
		b[i*2+1] = byte(v >> 8)
	}
	encoded := base64.StdEncoding.EncodeToString(b)
	cmd := hidden(exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("powershell: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func (windowsDesktop) SetBrightness(v float64) error {
	pct := int(v*100 + 0.5)
	ps := fmt.Sprintf("(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, %d)", pct)
	_, err := runPowerShell(ps)
	if err != nil {
		return fmt.Errorf("brightness control failed (only internal laptop screens are supported): %w", err)
	}
	return nil
}

// micScript reads (toggle false) or flips (toggle true) the mute of the default capture device and
// prints the state after: "muted" or "unmuted".
func micScript(toggle bool) string {
	call := "$false"
	if toggle {
		call = "$true"
	}
	return `
$csharp = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10(); int f11();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(); // first method of the interface (unused): the order must match
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}

public class AudioCapture {
    public static string Mute(bool toggle) {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        enumerator.GetDefaultAudioEndpoint(1, 1, out dev);
        var IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
        IAudioEndpointVolume ep;
        dev.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out ep);
        bool muted;
        ep.GetMute(out muted);
        if (toggle) {
            Guid empty = Guid.Empty;
            ep.SetMute(!muted, ref empty);
            muted = !muted;
        }
        return muted ? "muted" : "unmuted";
    }
}
'@
Add-Type -TypeDefinition $csharp -ErrorAction Stop
[AudioCapture]::Mute(` + call + `)
`
}

// MicMuted reads the default microphone's mute (the menu shows it before any toggle).
func (windowsDesktop) MicMuted() (bool, error) {
	out, err := runPowerShell(micScript(false))
	if err != nil {
		return false, fmt.Errorf("microphone state: %w", err)
	}
	switch {
	case strings.Contains(out, "unmuted"):
		return false, nil
	case strings.Contains(out, "muted"):
		return true, nil
	}
	return false, fmt.Errorf("microphone state: unexpected answer %q", strings.TrimSpace(out))
}

func (windowsDesktop) ToggleMicMute() (string, error) {
	out, err := runPowerShell(micScript(true))
	if err != nil {
		return "", fmt.Errorf("microphone toggle failed: %w", err)
	}
	if strings.Contains(out, "muted") && !strings.Contains(out, "unmuted") {
		return "muted", nil
	}
	if strings.Contains(out, "unmuted") {
		return "unmuted", nil
	}
	return "toggled", nil
}

func (windowsDesktop) Power(kind string) error {
	switch kind {
	case "shutdown":
		return hidden(exec.Command("shutdown", "/s", "/t", "0")).Run()
	case "restart":
		return hidden(exec.Command("shutdown", "/r", "/t", "0")).Run()
	case "suspend":
		ps := "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"
		_, err := runPowerShell(ps)
		return err
	default:
		return fmt.Errorf("unknown power action %q", kind)
	}
}

func (windowsDesktop) OpenApp(argv []string) error {
	return openProcess(argv)
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
		return ErrWindowNotFound
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
