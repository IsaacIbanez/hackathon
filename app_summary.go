package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/IsaacIbanez/hackathon/backend/session"
)

// Summaries with AI (task N7, brief docs/briefs/N7.md). The overlay's document options call this
// binding with the document's text; a selection (N6) will use the same call.

// SummaryResult is what Summarize returns to the UI (as JSON, see app_overlay.go).
type SummaryResult struct {
	session.Summary
	// TotalCostUSD is everything the models have cost since the app started (for N8).
	TotalCostUSD float64 `json:"totalCostUsd"`
	// Error, when there is no summary: a sentence the UI can read aloud.
	Error string `json:"error,omitempty"`
}

// Summarize summarizes text in language lang ("" = detect) with the cheap model first.
func (a *App) Summarize(text, lang string) string {
	if a.model == nil {
		return toJSON(SummaryResult{Error: "Summaries need the AI key: add OPENROUTER_API_KEY to the .env file."})
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	s, err := session.Summarize(ctx, a.model, text, lang, session.DefaultConfig().MaxTokens)
	total := a.model.Stats().TotalCostUSD
	if err != nil {
		log.Printf("summary: %v", err)
		msg := "The summary failed. Check the internet connection and try again."
		if errors.Is(err, session.ErrNothingToSummarize) {
			msg = "There is no text to summarize."
		}
		return toJSON(SummaryResult{Error: msg, TotalCostUSD: total})
	}
	log.Printf("summary: %s (%s, escalated=%v, cached=%v) %d ms, %.6f USD, %d+%d tokens, truncated=%v",
		s.Model, s.Tier, s.Escalated, s.Cached, s.LatencyMs, s.CostUSD, s.PromptTokens, s.CompletionTokens, s.Truncated)
	return toJSON(SummaryResult{Summary: s, TotalCostUSD: total})
}
