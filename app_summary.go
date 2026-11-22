package main

import (
	"context"
	"errors"
	"log"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/IsaacIbanez/hackathon/backend/overlay"
	"github.com/IsaacIbanez/hackathon/backend/summary"
)

// Option 4 (Didac, B2): summarize the text selected in any program, in 2–3 plain sentences.
// The summary is said aloud, copied to the clipboard and shown in a bubble next to the mouse
// pointer (the overlay window, shrunk). See docs/OVERLAY.md, «Resumir el texto seleccionado».
//
// Triggers: the overlay's option 4 today. Gesture Control's hand cursor (Nil) will call
// TriggerSummary when it has a "summarize" action: the overlay then opens option 4 by itself.

// Size of the summary bubble (logical pixels, like the rest of the window sizes).
const (
	bubbleWidth  = 540
	bubbleHeight = 360
)

// SummaryResult is what option 4 shows: the summary plus whether it was copied.
type SummaryResult struct {
	summary.Result
	Copied bool `json:"copied"`
}

// SummarizeSelection copies the selected text of the program that was in front, summarizes it,
// copies the summary to the clipboard and turns the window into a bubble next to the pointer.
// Errors start with "no_selection:" when there was nothing to copy.
func (a *App) SummarizeSelection() (string, error) {
	text, err := overlay.CopySelection()
	if errors.Is(err, overlay.ErrNoSelection) || errors.Is(err, overlay.ErrNoTarget) {
		a.showBubble()
		return "", errors.New("no_selection: Select some text in another program first, then open the overlay and press 4.")
	}
	if err != nil {
		a.showBubble()
		return "", err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	res := SummaryResult{Result: summary.Summarize(ctx, a.llm, text)}
	if err := overlay.SetClipboardText(res.Summary); err != nil {
		log.Printf("summary: could not copy it: %v", err)
	} else {
		res.Copied = true
	}
	log.Printf("summary: %d chars → %d (%s, %s, %.5f $, %d ms, truncated=%v) %s",
		res.Chars, len([]rune(res.Summary)), res.Source, res.Model, res.CostUSD, res.LatencyMs, res.Truncated, res.Note)
	a.showBubble()
	return toJSON(res), nil
}

// showBubble shrinks the overlay window next to the mouse pointer, on top, with the focus (so Esc
// and R work).
func (a *App) showBubble() {
	ctx := a.ctx
	a.overlay.mu.Lock()
	a.overlay.visible = true
	a.overlay.bubble = true
	a.overlay.mu.Unlock()
	wruntime.WindowShow(ctx)
	wruntime.WindowSetAlwaysOnTop(ctx, true)
	where, placed := overlay.PlaceNearCursor(bubbleWidth, bubbleHeight)
	log.Printf("summary: bubble %s", where)
	if !placed {
		wruntime.WindowSetSize(ctx, bubbleWidth, bubbleHeight)
		wruntime.WindowCenter(ctx)
	}
}

// CloseSummary closes the bubble: the window gets its size back, hides and the program the text
// came from gets the focus again.
func (a *App) CloseSummary() {
	a.overlay.mu.Lock()
	was := a.overlay.bubble
	a.overlay.bubble = false
	a.overlay.mu.Unlock()
	if !was {
		return
	}
	wruntime.WindowSetSize(a.ctx, overlayWidth, overlayHeight)
	wruntime.WindowCenter(a.ctx)
	a.HideOverlay()
	overlay.FocusTarget()
}

// TriggerSummary opens option 4 from outside the menu (prepared for the hand cursor of Gesture
// Control): it remembers the window in front and asks the overlay UI to run the summary.
func (a *App) TriggerSummary() {
	overlay.RememberTarget()
	wruntime.EventsEmit(a.ctx, "overlay:summarize")
}
