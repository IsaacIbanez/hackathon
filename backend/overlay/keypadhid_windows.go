//go:build windows

package overlay

import (
	"fmt"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	setupapi            = syscall.NewLazyDLL("setupapi.dll")
	procGetClassDevs    = setupapi.NewProc("SetupDiGetClassDevsW")
	procEnumInterfaces  = setupapi.NewProc("SetupDiEnumDeviceInterfaces")
	procInterfaceDetail = setupapi.NewProc("SetupDiGetDeviceInterfaceDetailW")
	procDestroyInfoList = setupapi.NewProc("SetupDiDestroyDeviceInfoList")
	procCancelIoEx      = kernel32.NewProc("CancelIoEx")
)

// GUID_DEVINTERFACE_HID
var hidInterfaceGUID = syscall.GUID{Data1: 0x4d1e55b2, Data2: 0xf16f, Data3: 0x11cf,
	Data4: [8]byte{0x88, 0xcb, 0x00, 0x11, 0x11, 0x00, 0x00, 0x30}}

type deviceInterfaceData struct {
	cbSize   uint32
	guid     syscall.GUID
	flags    uint32
	reserved uintptr
}

// keypadPaths lists the HID interfaces (one per collection) of the keypads plugged in.
func keypadPaths() []string {
	const digcfPresent, digcfDeviceInterface = 0x02, 0x10
	set, _, _ := procGetClassDevs.Call(uintptr(unsafe.Pointer(&hidInterfaceGUID)), 0, 0, digcfPresent|digcfDeviceInterface)
	if set == 0 || set == ^uintptr(0) {
		return nil
	}
	defer procDestroyInfoList.Call(set)
	want := strings.ToLower(fmt.Sprintf("vid_%04x&pid_%04x", KeypadVendorID, KeypadProductID))
	var out []string
	for i := 0; ; i++ {
		d := deviceInterfaceData{cbSize: uint32(unsafe.Sizeof(deviceInterfaceData{}))}
		ok, _, _ := procEnumInterfaces.Call(set, 0, uintptr(unsafe.Pointer(&hidInterfaceGUID)), uintptr(i), uintptr(unsafe.Pointer(&d)))
		if ok == 0 {
			return out
		}
		// SP_DEVICE_INTERFACE_DETAIL_DATA_W: a DWORD cbSize (8 on 64-bit, 6 on 32-bit) then the path.
		var buf [1024]uint16
		cb := uint32(6)
		if unsafe.Sizeof(uintptr(0)) == 8 {
			cb = 8
		}
		*(*uint32)(unsafe.Pointer(&buf[0])) = cb
		ok, _, _ = procInterfaceDetail.Call(set, uintptr(unsafe.Pointer(&d)), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2), 0, 0)
		if ok == 0 {
			continue
		}
		if p := syscall.UTF16ToString(buf[2:]); strings.Contains(strings.ToLower(p), want) {
			out = append(out, p)
		}
	}
}

func openHID(path string) (syscall.Handle, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	share := uint32(syscall.FILE_SHARE_READ | syscall.FILE_SHARE_WRITE)
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE, share, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		h, err = syscall.CreateFile(name, syscall.GENERIC_READ, share, nil, syscall.OPEN_EXISTING, 0, 0)
	}
	return h, err
}

// ListenKeypad reads the MX Creative Keypad directly and calls onKey(n) with the key (1–9) each
// time one is pressed, whatever window has the focus. It keeps looking for the keypad every few
// seconds, so it can be plugged in (or back in) later; onConnect reports each change. stop ends it.
func ListenKeypad(onKey func(n int), onConnect func(connected bool)) (stop func()) {
	done := make(chan struct{})
	var mu sync.Mutex
	open := map[string]syscall.Handle{}
	connected := false

	read := func(path string, h syscall.Handle) {
		buf := make([]byte, 512)
		for {
			var n uint32
			if err := syscall.ReadFile(h, buf, &n, nil); err != nil {
				break // unplugged, or stop cancelled the read
			}
			if k := KeypadKeyPressed(buf[:n]); k != 0 {
				onKey(k)
			}
		}
		mu.Lock()
		if open[path] == h {
			delete(open, path)
			syscall.CloseHandle(h)
		}
		mu.Unlock()
	}

	go func() {
		tick := time.NewTicker(2 * time.Second)
		defer tick.Stop()
		for {
			mu.Lock()
			for _, p := range keypadPaths() {
				if _, ok := open[p]; ok {
					continue
				}
				// Some collections (the keyboard-like ones) cannot be opened: that is fine, the keys
				// arrive on a vendor-defined one.
				if h, err := openHID(p); err == nil {
					open[p] = h
					go read(p, h)
				}
			}
			now := len(open) > 0
			changed := now != connected
			connected = now
			mu.Unlock()
			if changed && onConnect != nil {
				onConnect(now)
			}
			select {
			case <-done:
				return
			case <-tick.C:
			}
		}
	}()

	var once sync.Once
	return func() {
		once.Do(func() {
			close(done)
			mu.Lock()
			for p, h := range open {
				procCancelIoEx.Call(uintptr(h), 0)
				syscall.CloseHandle(h)
				delete(open, p)
			}
			mu.Unlock()
		})
	}
}
