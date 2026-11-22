package overlay

const (
	vkVolumeDown = 0xAE
	vkVolumeUp   = 0xAF
)

// VolumeStepKeys is how many volume-key presses one voice command makes: Windows moves the system
// volume 2 % per press, so 5 presses are 10 %.
const VolumeStepKeys = 5

// StepVolume raises (up) or lowers the system volume by one step (10 %), with the media volume keys,
// as if they were pressed on the keyboard. Windows shows its own volume indicator.
func StepVolume(up bool) error {
	vk := uintptr(vkVolumeDown)
	if up {
		vk = vkVolumeUp
	}
	for i := 0; i < VolumeStepKeys; i++ {
		key(vk, 0)
		key(vk, keyUp)
	}
	return nil
}
