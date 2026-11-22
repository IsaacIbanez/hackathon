package overlay

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildInfoString(t *testing.T) {
	b := BuildInfo{Commit: "abc1234", Modified: true, Built: "2026-11-22 03:40"}
	if got := b.String(); got != "abc1234+ (built 2026-11-22 03:40)" {
		t.Errorf("got %q", got)
	}
	if Build().Commit == "" {
		t.Error("Build must always name a commit (or unknown)")
	}
	old := StampedCommit
	defer func() { StampedCommit = old }()
	StampedCommit = "abc1234-dirty"
	if b := Build(); b.Commit != "abc1234" || !b.Modified {
		t.Errorf("stamped: %+v", b)
	}
}

func TestSetupProblems(t *testing.T) {
	t.Setenv("LAUZHACK_PYTHON", "")
	empty := t.TempDir() // no scanner/pdf/.venv here
	got := SetupProblems(empty, false)
	var text []string
	for _, p := range got {
		text = append(text, p.What)
		if p.Fix == "" {
			t.Errorf("%q has no fix", p.What)
		}
	}
	all := strings.Join(text, " | ")
	if !strings.Contains(all, "scanner is not installed") || !strings.Contains(all, "No AI key") {
		t.Errorf("want scanner and key problems, got %s", all)
	}

	t.Setenv("LAUZHACK_PYTHON", filepath.Join(empty, "python"))
	for _, p := range SetupProblems(empty, true) {
		if strings.Contains(p.What, "scanner is not installed") || strings.Contains(p.What, "No AI key") {
			t.Errorf("with LAUZHACK_PYTHON and a key: unexpected %q", p.What)
		}
	}
}
