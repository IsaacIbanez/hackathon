package captions

import (
	"encoding/binary"
	"math"
)

// Audio format of the /captions stream: signed 16-bit little-endian PCM, 16 kHz, mono.
const (
	SampleRate     = 16000
	bytesPerSecond = SampleRate * 2
)

func secondsOf(nBytes int) float64 { return float64(nBytes) / bytesPerSecond }

func byteAt(seconds float64) int {
	b := int(seconds*bytesPerSecond) &^ 1 // whole samples only
	return max(b, 0)
}

// wav wraps PCM s16le 16 kHz mono in a WAV header.
func wav(pcm []byte) []byte {
	out := make([]byte, 44+len(pcm))
	copy(out[0:], "RIFF")
	binary.LittleEndian.PutUint32(out[4:], uint32(36+len(pcm)))
	copy(out[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(out[16:], 16)
	binary.LittleEndian.PutUint16(out[20:], 1) // PCM
	binary.LittleEndian.PutUint16(out[22:], 1) // mono
	binary.LittleEndian.PutUint32(out[24:], SampleRate)
	binary.LittleEndian.PutUint32(out[28:], bytesPerSecond)
	binary.LittleEndian.PutUint16(out[32:], 2)
	binary.LittleEndian.PutUint16(out[34:], 16)
	copy(out[36:], "data")
	binary.LittleEndian.PutUint32(out[40:], uint32(len(pcm)))
	copy(out[44:], pcm)
	return out
}

// span is a time interval in seconds since the session began.
type span struct{ Start, End float64 }

func overlap(a, b span) float64 { return max(0, min(a.End, b.End)-max(a.Start, b.Start)) }

// voiceDetector finds the voiced intervals of the stream with an energy threshold over 20 ms
// frames, relative to an adaptive noise floor. It is only used to place each final sentence in
// time (the speech service does not send timestamps), so it can be coarse.
type voiceDetector struct {
	pending []byte  // bytes of an incomplete frame
	frames  int     // frames seen
	floor   float64 // noise floor (RMS)
	voiced  []span  // merged voiced intervals
}

const (
	vadFrameBytes = SampleRate / 50 * 2 // 20 ms
	vadFrameSec   = 0.02
	vadMinRMS     = 300 // ~-40 dBFS: quieter is silence whatever the floor
	vadGapSec     = 0.3 // gaps shorter than this do not split speech
)

func (v *voiceDetector) write(pcm []byte) {
	data := append(v.pending, pcm...)
	for len(data) >= vadFrameBytes {
		v.frame(data[:vadFrameBytes])
		data = data[vadFrameBytes:]
	}
	v.pending = append(v.pending[:0], data...)
}

func (v *voiceDetector) frame(f []byte) {
	var sum float64
	for i := 0; i+1 < len(f); i += 2 {
		s := float64(int16(binary.LittleEndian.Uint16(f[i:])))
		sum += s * s
	}
	rms := math.Sqrt(sum / float64(len(f)/2))
	if v.frames == 0 || rms < v.floor {
		v.floor = rms
	} else {
		v.floor += (rms - v.floor) * 0.002 // rises slowly in steady noise
	}
	t := float64(v.frames) * vadFrameSec
	v.frames++
	if rms < vadMinRMS || rms < v.floor*3 {
		return
	}
	if n := len(v.voiced); n > 0 && t-v.voiced[n-1].End <= vadGapSec {
		v.voiced[n-1].End = t + vadFrameSec
		return
	}
	v.voiced = append(v.voiced, span{t, t + vadFrameSec})
}

// sentenceSpan places a sentence that the service finished at audio time `at` and that
// started after `after` (the end of the previous sentence): from the first voiced frame
// after `after` to the last voiced frame before `at`. Without voice it returns (after, at).
func (v *voiceDetector) sentenceSpan(after, at float64) span {
	s := span{Start: -1, End: -1}
	for _, iv := range v.voiced {
		if iv.End <= after || iv.Start >= at {
			continue
		}
		if s.Start < 0 {
			s.Start = max(iv.Start, after)
		}
		s.End = min(iv.End, at)
	}
	if s.Start < 0 {
		return span{after, at}
	}
	return s
}
