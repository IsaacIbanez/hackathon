package session

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestSummarizeCheap(t *testing.T) {
	m := &fakeModel{cheap: "```json\n{\"summary\": \"Es una carta del banco.\", \"actions\": [\"Firma la hoja 2.\", \" \", \"Envíala antes del 15 de marzo\"]}\n```"}
	s, err := Summarize(context.Background(), m, "  Carta del banco\nFirme y envíe antes del 15 de marzo  ", "es-ES", 1500)
	if err != nil {
		t.Fatal(err)
	}
	if s.Escalated || s.Tier != "cheap" || s.Truncated {
		t.Errorf("want cheap, not truncated: %+v", s)
	}
	if len(s.Actions) != 2 || s.Actions[1] != "Envíala antes del 15 de marzo" {
		t.Errorf("actions: %q", s.Actions)
	}
	want := "Es una carta del banco. Lo que hay que hacer: Firma la hoja 2. Envíala antes del 15 de marzo."
	if s.Speech != want {
		t.Errorf("speech:\n got %q\nwant %q", s.Speech, want)
	}
	p := m.prompts[0]
	if !strings.Contains(p, "es-ES") || !strings.Contains(p, "Firme y envíe") || strings.Contains(p, "was cut") {
		t.Errorf("prompt: %s", p)
	}
}

func TestSummarySpeechIntroFollowsLanguage(t *testing.T) {
	a := summaryAnswer{Summary: "S.", Actions: []string{"Pagar."}}
	for lang, want := range map[string]string{"ca": "S. El que cal fer: Pagar.", "en-GB": "S. What to do: Pagar.", "": "S. What to do: Pagar."} {
		if got := speechFor(a, lang); got != want {
			t.Errorf("%q: %q", lang, got)
		}
	}
}

func TestSummarizeEscalatesWhenCheapIsUnusable(t *testing.T) {
	m := &fakeModel{cheap: "I cannot", expensive: `{"summary": "A tax letter.", "actions": []}`}
	s, err := Summarize(context.Background(), m, "Tax letter", "en", 1500)
	if err != nil || !s.Escalated || s.Speech != "A tax letter." || s.Actions == nil {
		t.Fatalf("%+v %v", s, err)
	}
}

func TestSummarizeFallsBackToPlainText(t *testing.T) {
	m := &fakeModel{cheap: "no json", expensive: "  Just a letter.  "}
	s, err := Summarize(context.Background(), m, "x", "", 1500)
	if err != nil || s.Summary != "Just a letter." || len(s.Actions) != 0 {
		t.Fatalf("%+v %v", s, err)
	}
}

func TestSummarizeErrors(t *testing.T) {
	if _, err := Summarize(context.Background(), &fakeModel{}, " \n ", "es", 0); !errors.Is(err, ErrNothingToSummarize) {
		t.Errorf("empty: %v", err)
	}
	boom := errors.New("network down")
	if _, err := Summarize(context.Background(), &fakeModel{err: boom}, "x", "es", 0); !errors.Is(err, boom) {
		t.Errorf("model error: %v", err)
	}
	if _, err := Summarize(context.Background(), &fakeModel{cheap: "", expensive: "  "}, "x", "es", 0); err == nil {
		t.Error("empty answer: want an error")
	}
}

func TestSummarizeCutsLongText(t *testing.T) {
	long := strings.Repeat("línea de texto con acentos áé\n", 1000) // > SummaryMaxChars bytes
	m := &fakeModel{cheap: `{"summary": "Largo.", "actions": []}`}
	s, err := Summarize(context.Background(), m, long, "es", 0)
	if err != nil || !s.Truncated {
		t.Fatalf("%+v %v", s, err)
	}
	p := m.prompts[0]
	if len(p) > SummaryMaxChars+500 || !strings.Contains(p, "was cut") {
		t.Errorf("prompt has %d bytes, cut note=%v", len(p), strings.Contains(p, "was cut"))
	}
	cut, _ := cutText(long, SummaryMaxChars)
	if !strings.HasSuffix(cut, "áé") {
		t.Errorf("cut must end at a line break: %q", cut[len(cut)-20:])
	}
}
