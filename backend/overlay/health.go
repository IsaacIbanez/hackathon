package overlay

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
)

// Startup health (R4, docs/arreglos/R4.md): which build is running and what is missing, so a stale
// .exe or a missing install is visible in the log and on screen instead of a half-working app.

// BuildInfo identifies the running executable.
type BuildInfo struct {
	Commit     string `json:"commit"`     // short git commit it was built from ("unknown" without git)
	Modified   bool   `json:"modified"`   // built with uncommitted changes
	CommitTime string `json:"commitTime"` // time of that commit (RFC 3339)
	Built      string `json:"built"`      // when the .exe was written (its file time)
}

// String is the short form for the log and the toolbar: "abc1234+ (built 2026-11-22 03:40)".
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
			case "vcs.time":
				b.CommitTime = s.Value
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

// Problem is something missing at startup, with what stops working and how to fix it.
type Problem struct {
	What string `json:"what"`
	Fix  string `json:"fix"`
}

// tesseractPaths are where the Windows installer puts Tesseract (the same ones scanner_pdf tries).
var tesseractPaths = []string{`C:\Program Files\Tesseract-OCR\tesseract.exe`, `C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`}

// SetupProblems checks what the tools need: the scanner's Python environment (PDF Scanner and
// Read Text), Tesseract (paper and scanned PDFs) and the AI key. root is the repository
// (RepoRoot); hasKey says whether the app found OPENROUTER_API_KEY.
func SetupProblems(root string, hasKey bool) []Problem {
	var out []Problem
	if os.Getenv("LAUZHACK_PYTHON") == "" {
		venv := filepath.Join(root, "scanner", "pdf", ".venv", "bin", "python")
		if runtime.GOOS == "windows" {
			venv = filepath.Join(root, "scanner", "pdf", ".venv", "Scripts", "python.exe")
		}
		if _, err := os.Stat(venv); err != nil {
			out = append(out, Problem{What: "The scanner is not installed: PDF Scanner and Read Text will not work.", Fix: "Run: task setup"})
		}
	}
	if !hasTesseract() {
		out = append(out, Problem{What: "Tesseract is missing: paper and scanned PDFs cannot be read.", Fix: "Run: task setup"})
	}
	if !hasKey {
		out = append(out, Problem{What: "No AI key: AI Summary uses its local fallback and voice commands do not work.", Fix: "Add OPENROUTER_API_KEY to the .env file next to the repository"})
	}
	return out
}

func hasTesseract() bool {
	if _, err := exec.LookPath("tesseract"); err == nil {
		return true
	}
	if runtime.GOOS == "windows" {
		for _, p := range tesseractPaths {
			if _, err := os.Stat(p); err == nil {
				return true
			}
		}
	}
	return false
}
