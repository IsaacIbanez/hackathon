package main

import (
	"errors"
	"log"
	"strings"

	"github.com/IsaacIbanez/hackathon/backend/overlay"
)

// maxReadChars caps what is read aloud at once (a whole selected page reads for minutes).
const maxReadChars = 4000

// ReadSelection copies the text selected in the program in front (Gesture Control's three-finger
// gesture) and returns it for the page to read aloud. Errors start with "no_selection:" when
// nothing was selected.
func (a *App) ReadSelection() (string, error) {
	text, err := overlay.CopySelection()
	if errors.Is(err, overlay.ErrNoSelection) || errors.Is(err, overlay.ErrNoTarget) {
		return "", errors.New("no_selection: Select some text first, then show three fingers.")
	}
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if r := []rune(text); len(r) > maxReadChars {
		text = string(r[:maxReadChars])
	}
	log.Printf("read selection: %d chars", len([]rune(text)))
	return text, nil
}

// DeleteSelection deletes the text selected in the program in front (voice command "borra el
// texto", docs/KEYPAD.md). Nothing is deleted unless some text is selected; then the error starts
// with "no_selection:".
func (a *App) DeleteSelection() (int, error) {
	n, err := overlay.DeleteSelection()
	if errors.Is(err, overlay.ErrNoSelection) || errors.Is(err, overlay.ErrNoTarget) {
		return 0, errors.New("no_selection: Select some text first, then give the command again.")
	}
	if err != nil {
		return 0, err
	}
	log.Printf("delete selection: %d chars", n)
	return n, nil
}
