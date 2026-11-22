package overlay

import (
	"runtime"
	"testing"
)

// On Windows it reads the real default microphone (muted or not, both are fine); elsewhere it says
// it is not implemented.
func TestMicMuted(t *testing.T) {
	muted, err := MicMuted()
	if runtime.GOOS != "windows" {
		if err == nil {
			t.Fatal("want an error outside Windows")
		}
		return
	}
	if err != nil {
		t.Fatalf("reading the microphone: %v", err)
	}
	t.Logf("default microphone muted: %v", muted)
}
