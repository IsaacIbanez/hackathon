package overlay

import (
	"os"
	"runtime/debug"
	"strings"
)

// Which build is running (R4, from PR #51): with several .exe around, the log and the menu say which
// commit this one was built from, so an old copy is spotted at once.

// BuildInfo identifies the running executable.
type BuildInfo struct {
	Commit   string `json:"commit"`   // short git commit it was built from ("unknown" without git)
	Modified bool   `json:"modified"` // built with uncommitted changes
	Built    string `json:"built"`    // when the .exe was written (its file time)
}

// String is the short form for the log and the menu: "abc1234+ (built 2026-11-22 03:40)".
func (b BuildInfo) String() string {
	s := b.Commit
	if b.Modified {
		s += "+"
	}
	if b.Built != "" {
		s += " (built " + b.Built + ")"
	}
	return s
}

// StampedCommit is set at build time by `task overlay` (-ldflags -X ...StampedCommit=…) with
// `git describe --always --dirty`: wails build does not stamp the VCS data that go build does.
var StampedCommit string

// Build says which commit the executable was built from: the stamp from `task overlay` or, for a
// plain go build, the VCS data Go adds on its own.
func Build() BuildInfo {
	b := BuildInfo{Commit: "unknown"}
	if c := strings.TrimSpace(StampedCommit); c != "" {
		b.Commit, b.Modified = strings.TrimSuffix(c, "-dirty"), strings.HasSuffix(c, "-dirty")
	} else if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				if len(s.Value) >= 7 {
					b.Commit = s.Value[:7]
				}
			case "vcs.modified":
				b.Modified = s.Value == "true"
			}
		}
	}
	if exe, err := os.Executable(); err == nil {
		if st, err := os.Stat(exe); err == nil {
			b.Built = st.ModTime().Local().Format("2006-01-02 15:04")
		}
	}
	return b
}
