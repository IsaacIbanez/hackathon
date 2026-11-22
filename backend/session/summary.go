package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

// Summaries with AI (task N7, brief docs/briefs/N7.md): what a document says and, above all, what
// the person has to do (dates, amounts, what to sign or send). It takes any text, so the same call
// serves the whole document now and a selection later (N6). Same frugal path as the explanation:
// cheap model first, the expensive one only if the cheap answer is unusable; cached and counted.

const summarySystemPrompt = `You help a person with low vision understand a document.
You receive its text (from OCR or a file). Write a short summary that is read aloud.
Rules:
- Use the document's language, plain words, short sentences, no jargon.
- "summary": 2 or 3 sentences: what the document is, who sends it and what it is about.
- "actions": what the person has to do, one short item each, with any dates, deadlines, amounts
  or places from the text (for example "Pay 45.20 euros before 15 March"). Empty if nothing.
- Never invent anything that is not in the text; if the text is unclear, say so in the summary.
- Reply ONLY with a JSON object: {"summary": "<2-3 sentences>", "actions": ["<item>", ...]}`

// SummaryMaxChars bounds the text sent to the model (about 2,000 tokens) so a summary with the
// cheap model stays under the brief's limit of 0.005 USD. Longer texts are cut and the summary
// says so.
const SummaryMaxChars = 8000

// ErrNothingToSummarize: the text is empty.
var ErrNothingToSummarize = errors.New("nothing to summarize: the document has no text")

// Summary is the result of Summarize, with what it cost (shown on screen, and measured for N8).
type Summary struct {
	Summary          string   `json:"summary"`
	Actions          []string `json:"actions"`
	Speech           string   `json:"speech"` // summary + actions, ready to read aloud
	Lang             string   `json:"lang"`
	Truncated        bool     `json:"truncated"` // the text was longer than SummaryMaxChars
	Model            string   `json:"model"`
	Tier             string   `json:"tier"`
	Escalated        bool     `json:"escalated"`
	Cached           bool     `json:"cached"`
	CostUSD          float64  `json:"costUsd"`
	LatencyMs        int64    `json:"latencyMs"`
	PromptTokens     int      `json:"promptTokens"`
	CompletionTokens int      `json:"completionTokens"`
}

type summaryAnswer struct {
	Summary string   `json:"summary"`
	Actions []string `json:"actions"`
}

// parseSummary extracts the JSON answer, tolerating code fences or text around it.
func parseSummary(text string) (summaryAnswer, bool) {
	var a summaryAnswer
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start || json.Unmarshal([]byte(text[start:end+1]), &a) != nil {
		return a, false
	}
	a.Summary = strings.TrimSpace(a.Summary)
	actions := a.Actions[:0]
	for _, x := range a.Actions {
		if x = strings.TrimSpace(x); x != "" {
			actions = append(actions, x)
		}
	}
	a.Actions = actions
	return a, a.Summary != ""
}

// cutText keeps at most max bytes of s without splitting a character, preferring a line break.
func cutText(s string, max int) (string, bool) {
	if len(s) <= max {
		return s, false
	}
	cut := s[:max]
	for !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	if i := strings.LastIndexByte(cut, '\n'); i > max/2 {
		cut = cut[:i]
	}
	return cut, true
}

func summaryPrompt(text, lang string, truncated bool) string {
	if lang == "" {
		lang = "unknown (detect it)"
	}
	note := ""
	if truncated {
		note = "\n(The text was cut: it is only the beginning of a longer document. Mention that briefly.)"
	}
	return fmt.Sprintf("Document language: %s\nText:\n%s%s\n\nSummarize it.", lang, text, note)
}

// speechFor joins the summary and the actions in one text to read aloud.
func speechFor(a summaryAnswer, lang string) string {
	if len(a.Actions) == 0 {
		return a.Summary
	}
	// Neutral forms: the model may address the person formally or not.
	intro := "What to do:"
	switch l := strings.ToLower(lang); {
	case strings.HasPrefix(l, "es"):
		intro = "Lo que hay que hacer:"
	case strings.HasPrefix(l, "ca"):
		intro = "El que cal fer:"
	}
	var b strings.Builder
	b.WriteString(a.Summary)
	b.WriteString(" ")
	b.WriteString(intro)
	for _, x := range a.Actions {
		x = strings.TrimRight(x, ". ")
		b.WriteString(" ")
		b.WriteString(x)
		b.WriteString(".")
	}
	return b.String()
}

// Summarize summarizes text (the whole document or a selection) in its language lang (BCP-47,
// "" = detect). maxTokens bounds the answer (reasoning models spend part of it thinking).
func Summarize(ctx context.Context, m Model, text, lang string, maxTokens int) (Summary, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Summary{}, ErrNothingToSummarize
	}
	text, truncated := cutText(text, SummaryMaxChars)
	req := llm.Request{
		System:    summarySystemPrompt,
		Messages:  []llm.Message{{Role: "user", Text: summaryPrompt(text, lang, truncated)}},
		MaxTokens: maxTokens,
		JSON:      true,
	}
	doubt := func(r llm.Response) bool { _, ok := parseSummary(r.Text); return !ok }
	r, escalated, err := m.CompleteWithEscalation(ctx, req, doubt)
	if err != nil {
		return Summary{}, err
	}
	a, ok := parseSummary(r.Text)
	if !ok { // even the expensive model ignored the format: read what it wrote
		a = summaryAnswer{Summary: strings.TrimSpace(r.Text)}
	}
	if a.Summary == "" {
		return Summary{}, errors.New("the model returned an empty summary")
	}
	if a.Actions == nil {
		a.Actions = []string{}
	}
	return Summary{
		Summary: a.Summary, Actions: a.Actions, Speech: speechFor(a, lang), Lang: lang, Truncated: truncated,
		Model: r.Model, Tier: string(r.Tier), Escalated: escalated, Cached: r.Cached,
		CostUSD: r.CostUSD, LatencyMs: r.LatencyMs, PromptTokens: r.PromptTokens, CompletionTokens: r.CompletionTokens,
	}, nil
}
