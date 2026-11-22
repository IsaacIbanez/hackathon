//go:build live

// Checks against the real Together AI (costs a fraction of a cent). Not part of `go test ./...`:
//
//	go test -tags live -run Live -v ./backend/captions
//
// The key is read from TOGETHER_API_KEY or from the .env at the repository root.
package captions

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/IsaacIbanez/hackathon/backend/llm"
)

func liveConfig(t *testing.T) Config {
	llm.LoadDotEnv("../../.env")
	key := os.Getenv("TOGETHER_API_KEY")
	if key == "" {
		t.Skip("no TOGETHER_API_KEY")
	}
	return Config{APIKey: key}.withDefaults()
}

func TestLivePolish(t *testing.T) {
	api := newTogether(liveConfig(t))
	history := []contextLine{
		{Speaker: "Speaker 1", Lang: "es", Text: `Mañana tenemos el "meeting" a las 10, no te olvides del "deadline".`},
		{Speaker: "Speaker 2", Lang: "en", Text: "Sure, I will send you the report before the meeting."},
		{Speaker: "Speaker 1", Lang: "es", Text: "Vale, entonces hablamos mañana."},
	}
	cases := []struct {
		name     string
		in       polishInput
		lang     string
		quoted   []string // must appear in quotes
		unquoted []string // must appear without quotes
		trHas    string   // the translation must contain this (case-insensitive); "" = no check
	}{
		{"barbarisms", polishInput{Sentence: "Mañana tenemos el meeting a las 10, no te olvides del deadline.", Speaker: "unknown", SpeakerLang: "unknown", Target: "en"},
			"es", []string{`"meeting"`, `"deadline"`}, nil, "meeting"},
		{"english meeting is not quoted", polishInput{Sentence: "Sure, I will send you the report before the meeting.", Speaker: "Speaker 2", SpeakerLang: "unknown", Target: "es", Conversation: history[:1]},
			"en", nil, []string{"the meeting"}, "reunión"},
		{"spanish phrase from an English speaker", polishInput{Sentence: "Okay, hasta luego.", Speaker: "Speaker 2", SpeakerLang: "en", Target: "es", Conversation: history},
			"en", []string{`"hasta luego"`}, nil, "hasta luego"},
		{"budget in a Spanish sentence", polishInput{Sentence: "Puedes revisar también el budget del proyecto.", Speaker: "Speaker 1", SpeakerLang: "unknown", Target: "es", Conversation: history[:2]},
			"es", []string{`"budget"`}, nil, ""},
		{"translates only the sentence", polishInput{Sentence: "Yes, no problem.", Speaker: "unknown", SpeakerLang: "unknown", Target: "es", Conversation: history},
			"en", nil, nil, "problema"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			start := time.Now()
			res, in, out, err := api.polish(ctx, c.in)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%v, %d+%d tokens: %+v", time.Since(start).Round(time.Millisecond), in, out, res)
			if res.Lang != c.lang {
				t.Errorf("lang = %q, want %q", res.Lang, c.lang)
			}
			if !sameWords(c.in.Sentence, res.Text) {
				t.Errorf("changed words: %q", res.Text)
			}
			for _, q := range c.quoted {
				if !strings.Contains(res.Text, q) {
					t.Errorf("want %s quoted in %q", q, res.Text)
				}
			}
			for _, u := range c.unquoted {
				if !strings.Contains(res.Text, u) {
					t.Errorf("want %q without quotes in %q", u, res.Text)
				}
			}
			if c.trHas != "" && !strings.Contains(strings.ToLower(res.Translation), c.trHas) {
				t.Errorf("translation %q should contain %q", res.Translation, c.trHas)
			}
		})
	}
}
