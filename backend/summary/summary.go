// Package summary summarizes a text in 2–3 plain sentences (overlay option "Summarize the selected
// text", role B2, docs/OVERLAY.md). It uses the cheap model tier (backend/llm: cache and cost meter,
// so the cost shows in the app's stats) and, without a key or when the model fails, a local
// extractive summary (0 $). Texts longer than MaxChars are cut and the result says so.
package summary

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

// MaxChars is the longest text sent to the model (~6 pages, ~0.003 $ with the cheap tier).
const MaxChars = 12000

// MinChars: shorter selections are not worth summarizing (they are read as they are).
const MinChars = 40

// Result is a summary and where it came from.
type Result struct {
	Summary   string  `json:"summary"`
	Lang      string  `json:"lang"`      // BCP-47 guess of the text's language (for the voice)
	Chars     int     `json:"chars"`     // characters of the selected text
	Truncated bool    `json:"truncated"` // longer than MaxChars: only the beginning was summarized
	Source    string  `json:"source"`    // "cloud" (model), "local" (no model) or "short" (read as is)
	Note      string  `json:"note,omitempty"`
	Model     string  `json:"model,omitempty"`
	CostUSD   float64 `json:"costUsd"`
	LatencyMs int64   `json:"latencyMs"`
	Cached    bool    `json:"cached"`
}

const system = `You summarize text for a person with low vision who will hear the summary aloud.
Answer ONLY with the summary: 2 or 3 short, plain sentences (45 words at most), in the same
language as the text. If the text has deadlines, dates, amounts or something the person must do,
say them; leave out phone numbers, addresses and polite formulas.
No introduction ("This text…" is fine, "Here is a summary" is not), no lists, no markdown.`

// Prepare normalizes the whitespace and cuts the text at MaxChars (at a sentence end or a space).
func Prepare(text string) (clean string, truncated bool) {
	clean = strings.Join(strings.Fields(text), " ")
	if len([]rune(clean)) <= MaxChars {
		return clean, false
	}
	r := []rune(clean)[:MaxChars]
	cut := string(r)
	if i := strings.LastIndexAny(cut, ".!?"); i > MaxChars/2 {
		cut = cut[:i+1]
	} else if i := strings.LastIndex(cut, " "); i > 0 {
		cut = cut[:i]
	}
	return cut, true
}

// Summarize summarizes the text with the cheap model; without a client (no key) or if the model
// fails, it falls back to Local and says why in Note.
func Summarize(ctx context.Context, c *llm.Client, text string) Result {
	clean, truncated := Prepare(text)
	res := Result{Chars: len([]rune(strings.TrimSpace(text))), Truncated: truncated, Lang: DetectLang(clean)}
	if len([]rune(clean)) < MinChars {
		res.Summary, res.Source = clean, "short"
		return res
	}
	if c == nil {
		return local(res, clean, "no OpenRouter key: local summary")
	}
	start := time.Now()
	resp, err := c.Complete(ctx, llm.Request{
		Tier:      llm.Cheap,
		System:    system,
		Messages:  []llm.Message{{Role: "user", Text: "Text to summarize:\n\"\"\"\n" + clean + "\n\"\"\""}},
		MaxTokens: 300,
	})
	summary := cleanAnswer(resp.Text)
	if err != nil || summary == "" {
		why := "the model gave no answer"
		if err != nil {
			why = err.Error()
		}
		return local(res, clean, "model failed ("+short(why)+"): local summary")
	}
	res.Summary, res.Source = summary, "cloud"
	res.Model, res.CostUSD, res.Cached = resp.Model, resp.CostUSD, resp.Cached
	res.LatencyMs = time.Since(start).Milliseconds()
	return res
}

func local(res Result, clean, note string) Result {
	res.Summary, res.Source, res.Note = Local(clean), "local", note
	return res
}

func short(s string) string {
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

var markdown = regexp.MustCompile(`(?m)^\s*(?:[-*•]|\d+[.)])\s+|[*_#` + "`" + `]+`)

// cleanAnswer removes markdown and a leading "Summary:" the model may add anyway.
func cleanAnswer(s string) string {
	s = markdown.ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	for _, p := range []string{"Resumen:", "Resum:", "Summary:"} {
		s = strings.TrimSpace(strings.TrimPrefix(s, p))
	}
	return s
}

var sentenceEnd = regexp.MustCompile(`[^.!?]+[.!?]+["»”)]*\s*|[^.!?]+$`)

// Important words: deadlines, money and what to do (es, ca, en).
var keywords = []string{
	"plazo", "antes", "hasta", "fecha", "vence", "pagar", "importe", "total", "euros", "debe", "deberá", "tiene que", "firmar", "enviar", "renovación",
	"termini", "abans", "data", "pagament", "import", "cal ", "heu de",
	"deadline", "before", "until", "due", "pay", "amount", "must", "sign", "send",
}

var number = regexp.MustCompile(`\d`)

// Local picks the 2–3 most informative sentences, in their original order (no model, 0 $):
// the first one, and the ones with numbers (dates, amounts) and words about deadlines or actions.
func Local(text string) string {
	sentences := sentenceEnd.FindAllString(text, -1)
	type scored struct {
		i     int
		s     string
		score float64
	}
	var all []scored
	for i, s := range sentences {
		s = strings.TrimSpace(s)
		if len([]rune(s)) < 15 {
			continue
		}
		low := strings.ToLower(s)
		score := 0.0
		if i == 0 {
			score += 2
		}
		if number.MatchString(s) {
			score += 2
		}
		for _, k := range keywords {
			if strings.Contains(low, k) {
				score++
			}
		}
		if len([]rune(s)) > 300 {
			score -= 1
		}
		all = append(all, scored{i, s, score})
	}
	if len(all) == 0 {
		return strings.TrimSpace(text)
	}
	sort.SliceStable(all, func(a, b int) bool { return all[a].score > all[b].score })
	n := 3
	if len(all) < n {
		n = len(all)
	}
	best := all[:n]
	sort.Slice(best, func(a, b int) bool { return best[a].i < best[b].i })
	parts := make([]string, len(best))
	for i, b := range best {
		parts[i] = b.s
	}
	return strings.Join(parts, " ")
}

var langWords = map[string][]string{
	"es-ES": {" el ", " la ", " de ", " que ", " y ", " los ", " para ", " con ", " su ", " una ", " se ", " del "},
	"ca-ES": {" el ", " la ", " de ", " que ", " i ", " els ", " per ", " amb ", " seu ", " una ", " es ", " del "},
	"en-GB": {" the ", " of ", " and ", " to ", " a ", " is ", " for ", " with ", " your ", " you ", " in ", " that "},
}

// DetectLang guesses Spanish, Catalan or English by common words (Spanish if unsure). It is only
// used to choose the voice; the model answers in the text's language anyway.
func DetectLang(text string) string {
	low := " " + strings.Map(func(r rune) rune {
		if unicode.IsPunct(r) {
			return ' '
		}
		return unicode.ToLower(r)
	}, text) + " "
	best, bestN := "es-ES", 0
	for _, lang := range []string{"es-ES", "ca-ES", "en-GB"} {
		n := 0
		for _, w := range langWords[lang] {
			n += strings.Count(low, w)
		}
		if n > bestN {
			best, bestN = lang, n
		}
	}
	return best
}
