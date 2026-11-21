package captions

import (
	"fmt"
	"sort"
	"strings"
)

// turn is a stretch of audio said by one speaker, as diarization returns it.
type turn struct {
	span
	Speaker string // label local to one diarization request (SPEAKER_00...), or global after mapping
}

// speakerMap joins the diarization of successive, overlapping windows into one set of global
// speakers. Each window labels its speakers on its own (SPEAKER_00 in one window may be
// SPEAKER_01 in the next), so a window's local labels are matched to the global speakers who
// talk in the overlap with the windows before it.
type speakerMap struct {
	turns   []turn // global turns, in time order
	covered float64
	n       int // global speakers so far
}

// minMatchSec is how much shared speech it takes to say two labels are the same person.
const minMatchSec = 0.5

// add merges the turns of the window [from, to] (already in session time); sentences are
// labeled afterwards with speakerOf.
func (m *speakerMap) add(from, to float64, window []turn) {
	overlapEnd := m.covered
	type pair struct {
		local, global string
		shared        float64
	}
	var pairs []pair
	shared := map[[2]string]float64{}
	for _, w := range window {
		if w.Start >= overlapEnd {
			continue
		}
		seg := span{w.Start, min(w.End, overlapEnd)}
		for _, g := range m.turns {
			if o := overlap(seg, g.span); o > 0 {
				shared[[2]string{w.Speaker, g.Speaker}] += o
			}
		}
	}
	for k, v := range shared {
		if v >= minMatchSec {
			pairs = append(pairs, pair{k[0], k[1], v})
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].shared != pairs[j].shared {
			return pairs[i].shared > pairs[j].shared
		}
		return pairs[i].local < pairs[j].local
	})
	toGlobal := map[string]string{}
	taken := map[string]bool{}
	for _, p := range pairs {
		if toGlobal[p.local] != "" || taken[p.global] {
			continue
		}
		toGlobal[p.local] = p.global
		taken[p.global] = true
	}
	// New speakers are numbered in order of first appearance.
	sorted := append([]turn(nil), window...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })
	for _, w := range sorted {
		if toGlobal[w.Speaker] == "" {
			m.n++
			toGlobal[w.Speaker] = fmt.Sprintf("Speaker %d", m.n)
		}
	}
	// Keep the old turns in the overlap; append the window's turns after it.
	for _, w := range sorted {
		if w.End <= overlapEnd {
			continue
		}
		start := max(w.Start, overlapEnd)
		m.turns = append(m.turns, turn{span{start, w.End}, toGlobal[w.Speaker]})
	}
	m.covered = max(m.covered, to)
}

// speakerOf returns the global speaker who talks most during s, or "" if nobody does.
func (m *speakerMap) speakerOf(s span) string {
	best, bestSec := "", 0.0
	time := map[string]float64{}
	for _, t := range m.turns {
		if o := overlap(s, t.span); o > 0 {
			time[t.Speaker] += o
			if time[t.Speaker] > bestSec || (time[t.Speaker] == bestSec && t.Speaker < best) {
				best, bestSec = t.Speaker, time[t.Speaker]
			}
		}
	}
	return best
}

// alignTo renames m's speakers after the labels the sentences already have (the live ones),
// pairing the voices that share the most speech, so the final pass keeps the numbering people
// already see on screen ("Speaker 1" does not become "Speaker 2"). Voices with no live
// counterpart get the next free numbers.
func (m *speakerMap) alignTo(sentences []*sentence) {
	shared := map[[2]string]float64{} // {new label, live label} -> seconds
	used := 0
	for _, s := range sentences {
		var n int
		if _, err := fmt.Sscanf(s.Speaker, "Speaker %d", &n); err == nil && n > used {
			used = n
		}
		if s.Speaker == "" {
			continue
		}
		if l := m.speakerOf(s.span); l != "" {
			shared[[2]string{l, s.Speaker}] += max(0.1, s.End-s.Start)
		}
	}
	type pair struct {
		from, to string
		sec      float64
	}
	var pairs []pair
	for k, v := range shared {
		pairs = append(pairs, pair{k[0], k[1], v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].sec != pairs[j].sec {
			return pairs[i].sec > pairs[j].sec
		}
		return pairs[i].from+pairs[i].to < pairs[j].from+pairs[j].to
	})
	rename := map[string]string{}
	taken := map[string]bool{}
	for _, p := range pairs {
		if rename[p.from] != "" || taken[p.to] {
			continue
		}
		rename[p.from] = p.to
		taken[p.to] = true
	}
	for i, t := range m.turns {
		if rename[t.Speaker] == "" {
			used++
			rename[t.Speaker] = fmt.Sprintf("Speaker %d", used)
		}
		m.turns[i].Speaker = rename[t.Speaker]
	}
	m.n = max(m.n, used)
}

// minRefineWords: shorter sentences ("OK", "Gracias") say little about who speaks.
// longSentenceWords: from this length the language beats the voice.
const (
	minRefineWords    = 3
	longSentenceWords = 4
)

// refineByLanguage uses the language as a cue when at least two people talk (said by the user
// or found by the diarization) and each keeps to their own language, as in a meeting between
// a Spanish and an English speaker. Voice diarization mixes such speakers up when they take
// turns (tested with Together's diarization), while the language tells them apart:
//   - a full sentence in a language that is not the usual one of its speaker moves to the
//     only speaker who usually speaks that language (sentences without a speaker too);
//   - if there are fewer labels than people, a label whose sentences are in two languages is
//     split: the less used language becomes a new speaker.
//
// Barbarisms do not count: a Spanish sentence with "meeting" is Spanish. Returns the changed
// sentences. Call with the session lock held.
func refineByLanguage(sentences []*sentence, people int) []*sentence {
	changed := map[*sentence]bool{}
	labels := func() []string {
		var out []string
		seen := map[string]bool{}
		for _, s := range sentences {
			if s.Speaker != "" && !seen[s.Speaker] {
				seen[s.Speaker] = true
				out = append(out, s.Speaker)
			}
		}
		return out
	}
	full := func(s *sentence) bool { return s.Lang != "" && len(strings.Fields(s.Text)) >= minRefineWords }
	if byLang := oneLanguagePerPerson(sentences, people, full); byLang != nil {
		owner := map[string]bool{}
		for _, l := range byLang {
			owner[l] = true
		}
		for _, s := range sentences {
			l, ok := byLang[s.Lang]
			if !ok || s.Speaker == l {
				continue
			}
			// A short phrase from a known person follows the voice: that is where barbarisms
			// are ("Okay, hasta luego" from the English speaker); it is checked again later
			// with that person's language.
			if s.Speaker != "" && owner[s.Speaker] && len(strings.Fields(s.Text)) < longSentenceWords {
				continue
			}
			s.Speaker = l
			changed[s] = true
		}
		return keys(changed)
	}
	if len(labels()) < people {
		for _, l := range labels() {
			count := map[string]int{}
			for _, s := range sentences {
				if s.Speaker == l && full(s) {
					count[s.Lang]++
				}
			}
			major, minor := "", ""
			for lang, n := range count {
				if n < 2 {
					continue
				}
				switch {
				case major == "" || n > count[major] || (n == count[major] && lang < major):
					major, minor = lang, major
				case minor == "" || n > count[minor] || (n == count[minor] && lang < minor):
					minor = lang
				}
			}
			if minor == "" || len(labels()) >= people {
				continue
			}
			next := nextSpeaker(sentences)
			for _, s := range sentences {
				if s.Speaker == l && full(s) && s.Lang == minor {
					s.Speaker = next
					changed[s] = true
				}
			}
		}
	}
	if len(labels()) < 2 {
		return keys(changed)
	}
	for range 3 { // moving sentences makes the usual languages clearer: repeat a few times
		usual := map[string]string{}
		owners := map[string][]string{}
		for _, l := range labels() {
			if u := usualLanguage(sentences, l, nil); u != "" {
				usual[l] = u
				owners[u] = append(owners[u], l)
			}
		}
		moved := false
		for _, s := range sentences {
			// Move a sentence only with evidence: no speaker yet, or a speaker whose usual
			// language is a different one.
			if s.Lang == "" || (s.Speaker != "" && (!full(s) || usual[s.Speaker] == "" || usual[s.Speaker] == s.Lang)) {
				continue
			}
			if o := owners[s.Lang]; len(o) == 1 && o[0] != s.Speaker {
				s.Speaker = o[0]
				changed[s] = true
				moved = true
			}
		}
		if !moved {
			break
		}
	}
	return keys(changed)
}

func nextSpeaker(sentences []*sentence) string {
	top := 0
	for _, s := range sentences {
		var n int
		if _, err := fmt.Sscanf(s.Speaker, "Speaker %d", &n); err == nil && n > top {
			top = n
		}
	}
	return fmt.Sprintf("Speaker %d", top+1)
}

func keys(m map[*sentence]bool) []*sentence {
	out := make([]*sentence, 0, len(m))
	for s := range m {
		out = append(out, s)
	}
	return out
}

// oneLanguagePerPerson handles the case the user describes as "each person speaks their own
// language": as many languages (with 2+ full sentences each) as people said to be talking. It
// gives each language one speaker, keeping the labels that already hold most of its sentences
// (so the numbering on screen changes as little as possible). nil if it does not apply.
func oneLanguagePerPerson(sentences []*sentence, people int, full func(*sentence) bool) map[string]string {
	if people < 2 {
		return nil
	}
	perLang := map[string]int{}
	under := map[[2]string]int{} // {lang, label} -> full sentences
	for _, s := range sentences {
		if full(s) {
			perLang[s.Lang]++
			if s.Speaker != "" {
				under[[2]string{s.Lang, s.Speaker}]++
			}
		}
	}
	var langs []string
	for l, n := range perLang {
		if n >= 2 {
			langs = append(langs, l)
		}
	}
	if len(langs) != people {
		return nil
	}
	type pair struct {
		lang, label string
		n           int
	}
	var pairs []pair
	for k, n := range under {
		if perLang[k[0]] >= 2 {
			pairs = append(pairs, pair{k[0], k[1], n})
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].n != pairs[j].n {
			return pairs[i].n > pairs[j].n
		}
		return pairs[i].lang+pairs[i].label < pairs[j].lang+pairs[j].label
	})
	out := map[string]string{}
	taken := map[string]bool{}
	for _, p := range pairs {
		if out[p.lang] != "" || taken[p.label] {
			continue
		}
		out[p.lang] = p.label
		taken[p.label] = true
	}
	sort.Strings(langs)
	for _, l := range langs {
		if out[l] == "" {
			next := nextSpeaker(sentences)
			for taken[next] {
				var n int
				fmt.Sscanf(next, "Speaker %d", &n)
				next = fmt.Sprintf("Speaker %d", n+1)
			}
			out[l] = next
			taken[next] = true
		}
	}
	return out
}
