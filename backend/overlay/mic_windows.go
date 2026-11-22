package overlay

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
)

// micMutedScript reads (never changes) whether the default microphone is muted in Windows, with
// Core Audio: the same interfaces as Gesture Control's microphone toggle
// (adapters/desktop/control/desktop_windows.go), only GetMute. Role 0 (console) is the device a
// page gets from getUserMedia by default.
const micMutedScript = `
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
    int EnumAudioEndpoints();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}
public class MicState {
    public static bool Muted() {
        var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        e.GetDefaultAudioEndpoint(1, 0, out dev);
        var iid = typeof(IAudioEndpointVolume).GUID;
        IAudioEndpointVolume ep;
        dev.Activate(ref iid, 23, IntPtr.Zero, out ep);
        bool muted;
        ep.GetMute(out muted);
        return muted;
    }
}
'@
Add-Type -TypeDefinition $csharp -ErrorAction Stop
if ([MicState]::Muted()) { 'muted' } else { 'on' }
`

// MicMuted says whether the default microphone is muted in Windows (about 1 s: it runs PowerShell).
func MicMuted() (bool, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", micMutedScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return false, err
	}
	switch strings.TrimSpace(string(out)) {
	case "muted":
		return true, nil
	case "on":
		return false, nil
	}
	return false, errors.New("could not read the microphone state")
}
