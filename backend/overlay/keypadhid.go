package overlay

// Reading the MX Creative Keypad directly over USB, without Logi Options+ (brief docs/briefs/N2.md).
// Measured on 2026-11-22 with the keypad plugged in by USB and no Options+ installed: on one of its
// vendor-defined HID collections it sends, for every key,
//
//	13 ff 02 00 <counter> 01 <key>   key 1–9 when pressed, 00 when released
//
// (padded with zeros). The Windows part that opens the device is in keypadhid_windows.go.

const (
	// KeypadVendorID and KeypadProductID identify the MX Creative Keypad on USB.
	KeypadVendorID  = 0x046D // Logitech
	KeypadProductID = 0xC354
)

// KeypadKeyPressed returns the key (1–9) a keypad HID report announces as pressed, or 0 when the
// report is a release or something else.
func KeypadKeyPressed(r []byte) int {
	if len(r) < 7 || r[0] != 0x13 || r[1] != 0xff || r[2] != 0x02 || r[3] != 0x00 || r[5] != 0x01 {
		return 0
	}
	if k := int(r[6]); k >= 1 && k <= 9 {
		return k
	}
	return 0
}

// KeypadActionForKey is the action of physical key n (1–9): the n-th row of DefaultKeypad, the same
// one its fallback shortcut does.
func KeypadActionForKey(n int) (KeypadAction, bool) {
	if n < 1 || n > len(DefaultKeypad) {
		return "", false
	}
	return DefaultKeypad[n-1].Action, true
}
