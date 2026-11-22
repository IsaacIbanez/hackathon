package main

import (
	"log"

	"github.com/IsaacIbanez/hackathon/backend/overlay"
)

// UILog writes a line from the page in lauzhack.log (the desktop build has no console to look at).
func (a *App) UILog(msg string) {
	if r := []rune(msg); len(r) > 300 {
		msg = string(r[:300])
	}
	log.Printf("ui: %s", msg)
}

// MicMuted says whether the default microphone is muted in Windows (a silent voice command asks it,
// to tell the person why nothing was heard).
func (a *App) MicMuted() (bool, error) {
	muted, err := overlay.MicMuted()
	log.Printf("microphone: muted=%v (err=%v)", muted, err)
	return muted, err
}

// ChangeVolume raises (up) or lowers the system volume by one step of 10 % (voice commands "sube el
// volumen" / "baja el volumen", docs/KEYPAD.md).
func (a *App) ChangeVolume(up bool) error {
	err := overlay.StepVolume(up)
	log.Printf("volume: up=%v (err=%v)", up, err)
	return err
}
