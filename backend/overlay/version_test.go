package overlay

import "testing"

func TestBuildInfoString(t *testing.T) {
	cases := map[string]BuildInfo{
		"abc1234":                          {Commit: "abc1234"},
		"abc1234+":                         {Commit: "abc1234", Modified: true},
		"abc1234 (built 2026-11-22 03:40)": {Commit: "abc1234", Built: "2026-11-22 03:40"},
	}
	for want, b := range cases {
		if got := b.String(); got != want {
			t.Errorf("%+v: got %q, want %q", b, got, want)
		}
	}
}

func TestBuildUsesTheStamp(t *testing.T) {
	old := StampedCommit
	defer func() { StampedCommit = old }()
	StampedCommit = "54f0589-dirty"
	b := Build()
	if b.Commit != "54f0589" || !b.Modified {
		t.Fatalf("got %+v", b)
	}
}
