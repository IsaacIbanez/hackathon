package main

import (
	"log"

	"github.com/IsaacIbanez/hackathon/backend/overlay"
)

// ChangeVolume raises (up) or lowers the system volume by one step of 10 % (voice commands "sube el
// volumen" / "baja el volumen", docs/KEYPAD.md).
func (a *App) ChangeVolume(up bool) error {
	err := overlay.StepVolume(up)
	log.Printf("volume: up=%v (err=%v)", up, err)
	return err
}
