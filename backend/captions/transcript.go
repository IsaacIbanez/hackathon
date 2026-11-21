package captions

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// sentence is one final caption.
type sentence struct {
	ID           string
	span         // seconds since the session began
	Text         string
	Speaker      string            // "" until diarization labels it
	Lang         string            // main language (ISO 639-1), "" until the model says
	Translations map[string]string // target language -> text

	shown       bool   // the final was sent to the client
	polishedFor string // speaker assumed when the model last checked it
}

func clock(sec float64) string {
	s := int(sec)
	return fmt.Sprintf("%02d:%02d:%02d", s/3600, s/60%60, s%60)
}

// line is "[00:01:02] Speaker 1 (es): text"; the speaker and the language only when known.
func line(s *sentence, text string, withLang bool) string {
	who := s.Speaker
	if withLang && s.Lang != "" {
		who = strings.TrimSpace(who + " (" + s.Lang + ")")
	}
	if who != "" {
		who += ": "
	}
	return fmt.Sprintf("[%s] %s%s\n", clock(s.Start), who, text)
}

// renderTranscript writes the original first and then, for each language it was translated
// to (in order of first use), the translation.
func renderTranscript(started time.Time, lang string, langs []string, sentences []*sentence) string {
	var b strings.Builder
	translated := "none"
	if len(langs) > 0 {
		translated = strings.Join(langs, ", ")
	}
	fmt.Fprintf(&b, "Live captions — %s — spoken: %s — translated to: %s\n", started.Format("2006-01-02 15:04"), lang, translated)
	b.WriteString("== Original ==\n")
	for _, s := range sentences {
		b.WriteString(line(s, s.Text, true))
	}
	for _, l := range langs {
		fmt.Fprintf(&b, "\n== Translation (%s) ==\n", l)
		for _, s := range sentences {
			if t, ok := s.Translations[l]; ok {
				b.WriteString(line(s, t, false))
			}
		}
	}
	return b.String()
}

// transcriptPath picks a new file name in dir: captions-YYYY-MM-DD-HHMM.txt (-2, -3... if taken).
func transcriptPath(dir string, started time.Time) string {
	base := filepath.Join(dir, "captions-"+started.Format("2006-01-02-1504"))
	p := base + ".txt"
	for i := 2; ; i++ {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
		p = fmt.Sprintf("%s-%d.txt", base, i)
	}
}

// writeFileAtomic replaces path with data, so a crash never leaves half a transcript.
func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
