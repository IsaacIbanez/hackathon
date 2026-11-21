package captions

import (
	"fmt"
	"sort"
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
