package captions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode"
)

// One small language-model call per final sentence does three things at once (frugal):
//   - the sentence's main language (people may speak different languages in one meeting);
//   - words from another language (barbarisms: "el meeting", "hasta luego" said by an English
//     speaker) wrapped in double quotes, using the conversation and the speaker's usual
//     language as context;
//   - the translation into the target language, if there is one.
// The model may only add quotes: if it changed any word, Go keeps the original text.

// contextLine is a previous sentence of the conversation, as context for the model.
type contextLine struct {
	Speaker string `json:"speaker,omitempty"`
	Lang    string `json:"lang,omitempty"`
	Text    string `json:"text"`
}

type polishInput struct {
	Sentence     string        `json:"sentence"`
	Speaker      string        `json:"speaker"`
	SpeakerLang  string        `json:"speaker_usual_language"`
	Target       string        `json:"translate_to"`
	Conversation []contextLine `json:"previous_lines"`
}

type polishResult struct {
	Lang        string `json:"lang"`
	Text        string `json:"text"`
	Translation string `json:"translation"`
}

const polishSystem = `You process live captions of a meeting. People may speak different languages, and they often mix in words from other languages (barbarisms, e.g. a Spanish speaker saying "el meeting" or "el deadline", or an English speaker saying "hasta luego").

You get JSON with:
- "sentence": the new sentence. It is the ONLY text you work on.
- "speaker" and "speaker_usual_language": who says it and the language that person usually speaks ("unknown" if not known yet).
- "translate_to": the language to translate to ("none" = do not translate).
- "previous_lines": earlier sentences, ONLY as context to tell languages apart. Never translate or copy them.

Reply with JSON only: {"lang": "...", "text": "...", "translation": "..."}
- lang: ISO 639-1 code of the main language of "sentence" (the language of its grammar and most of its words). A short sentence or set phrase from a speaker who usually speaks X is in X with foreign words, unless it is clearly a full sentence in another language.
- text: "sentence" EXACTLY as given, except that each word or short phrase that is NOT in "lang" is wrapped in double quotes. Loanwords people use every day are still foreign words: in Spanish, quote "meeting", "deadline", "budget", "feedback", "email", "call"... A word of "lang" is never quoted, even if it was quoted in another line ("meeting" is quoted in a Spanish sentence, but not in an English one). Do not quote names of people, places, companies or products, numbers, or text already in quotes. Never change, fix, add, remove or reorder any other character.
- translation: "sentence" (and only it) translated into "translate_to", natural, with the foreign words translated too and no quote marks. Empty string if "translate_to" is "none" or "lang" is already "translate_to".

Examples (translate_to "es"):
{"sentence": "Mañana tenemos el meeting, no olvides el deadline."} -> {"lang": "es", "text": "Mañana tenemos el \"meeting\", no olvides el \"deadline\".", "translation": ""}
{"sentence": "Sure, I will send the report before the meeting."} -> {"lang": "en", "text": "Sure, I will send the report before the meeting.", "translation": "Claro, enviaré el informe antes de la reunión."}
{"sentence": "Okay, hasta luego!", "speaker_usual_language": "en"} -> {"lang": "en", "text": "Okay, \"hasta luego\"!", "translation": "Vale, ¡hasta luego!"}`

var jsonObject = regexp.MustCompile(`(?s)\{.*\}`)

// polish asks the language model about one sentence; it returns the tokens it used.
func (t *together) polish(ctx context.Context, in polishInput) (polishResult, int, int, error) {
	user, _ := json.Marshal(in)
	reqBody := map[string]any{
		"model": t.cfg.TranslateModel,
		"messages": []map[string]string{
			{"role": "system", "content": polishSystem},
			{"role": "user", "content": string(user)},
		},
		"temperature":     0,
		"max_tokens":      600,
		"response_format": map[string]string{"type": "json_object"},
		// Qwen3.5 thinks by default: it spent all its tokens reasoning and answered nothing
		// (2.3 s). Without reasoning it answers in ~0.2-0.4 s.
		"reasoning": map[string]bool{"enabled": false},
	}
	data, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.cfg.APIURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return polishResult{}, 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+t.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Prompt     int `json:"prompt_tokens"`
			Completion int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := t.do(req, &out); err != nil {
		return polishResult{}, 0, 0, fmt.Errorf("language model: %w", err)
	}
	in1, out1 := out.Usage.Prompt, out.Usage.Completion
	if len(out.Choices) == 0 {
		return polishResult{}, in1, out1, errors.New("language model: empty answer")
	}
	raw := jsonObject.FindString(thinkBlock.ReplaceAllString(out.Choices[0].Message.Content, ""))
	var res polishResult
	if raw == "" || json.Unmarshal([]byte(raw), &res) != nil {
		return polishResult{}, in1, out1, errors.New("language model: the answer is not JSON")
	}
	res.Lang = strings.ToLower(strings.TrimSpace(res.Lang))
	if !langCode.MatchString(res.Lang) {
		res.Lang = ""
	}
	res.Text = strings.TrimSpace(res.Text)
	// Quotes mark barbarisms in the original; a translation has none of its own.
	res.Translation = strings.TrimSpace(strings.NewReplacer("\"", "", "“", "", "”", "").Replace(res.Translation))
	return res, in1, out1, nil
}

// quoteMarks are the quotes the model may add (and that are ignored when comparing).
const quoteMarks = "\"“”«»„"

// sameWords says whether quoted only adds quotes to original: the same characters once quote
// marks and spacing are ignored (case and punctuation must match).
func sameWords(original, quoted string) bool {
	norm := func(s string) string {
		var b strings.Builder
		for _, r := range s {
			if unicode.IsSpace(r) || strings.ContainsRune(quoteMarks, r) {
				continue
			}
			b.WriteRune(r)
		}
		return b.String()
	}
	return norm(original) == norm(quoted)
}

// usualLanguage returns the language a speaker uses in most of their sentences (at least two,
// and 60 % of them), ignoring `skip`; "" if there is not enough to say. Call with s.mu held.
func usualLanguage(sentences []*sentence, speaker string, skip *sentence) string {
	if speaker == "" {
		return ""
	}
	count := map[string]int{}
	total := 0
	for _, x := range sentences {
		if x == skip || x.Speaker != speaker || x.Lang == "" {
			continue
		}
		count[x.Lang]++
		total++
	}
	best, n := "", 0
	for l, c := range count {
		if c > n || (c == n && l < best) {
			best, n = l, c
		}
	}
	if n < 2 || float64(n) < 0.6*float64(total) {
		return ""
	}
	return best
}
