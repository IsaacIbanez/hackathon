package overlay

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func checkEnv(env map[string]string, files ...string) CheckEnv {
	have := map[string]bool{}
	for _, f := range files {
		have[f] = true
	}
	return CheckEnv{
		Getenv:   func(k string) string { return env[k] },
		Exists:   func(p string) bool { return have[p] },
		LookPath: func(string) (string, error) { return "", errors.New("not found") },
		Root:     `C:\repo`,
		GOOS:     "windows",
	}
}

var venv = filepath.Join(`C:\repo`, "scanner", "pdf", ".venv", "Scripts", "python.exe")

func TestStartupProblemsAllGood(t *testing.T) {
	e := checkEnv(map[string]string{"OPENROUTER_API_KEY": "k", "TOGETHER_API_KEY": "k"}, venv, TesseractWindowsPaths[0])
	if got := StartupProblems(e); len(got) != 0 {
		t.Fatalf("want no problems, got %q", got)
	}
}

func TestStartupProblemsEachOneSaysWhatToDo(t *testing.T) {
	got := StartupProblems(checkEnv(map[string]string{}))
	want := []string{"OPENROUTER_API_KEY", "TOGETHER_API_KEY", "PDF Scanner is not installed", "Tesseract"}
	if len(got) != len(want) {
		t.Fatalf("got %d problems: %q", len(got), got)
	}
	for i, w := range want {
		if !strings.Contains(got[i], w) {
			t.Errorf("problem %d: %q should mention %q", i, got[i], w)
		}
	}
	// The scanner ones give the exact command.
	for _, p := range got[2:] {
		if !strings.Contains(p, InstallScannerCommand) {
			t.Errorf("%q should give the install command", p)
		}
	}
}

func TestStartupProblemsFixtureNeedsNoScanner(t *testing.T) {
	e := checkEnv(map[string]string{"OPENROUTER_API_KEY": "k", "TOGETHER_API_KEY": "k", "SCANNER_URL": "fixture"})
	if got := StartupProblems(e); len(got) != 0 {
		t.Fatalf("with fixtures nothing else is needed, got %q", got)
	}
}

func TestStartupProblemsOwnPythonAndTesseract(t *testing.T) {
	e := checkEnv(map[string]string{
		"OPENROUTER_API_KEY": "k", "TOGETHER_API_KEY": "k",
		"LAUZHACK_PYTHON": `C:\py\python.exe`, "TESSERACT_CMD": `C:\t\tesseract.exe`,
	}, `C:\t\tesseract.exe`)
	if got := StartupProblems(e); len(got) != 0 {
		t.Fatalf("LAUZHACK_PYTHON and TESSERACT_CMD should be trusted, got %q", got)
	}
	e.LookPath = func(string) (string, error) { return `C:\path\tesseract.exe`, nil }
	e.Getenv = func(k string) string {
		return map[string]string{"OPENROUTER_API_KEY": "k", "TOGETHER_API_KEY": "k", "LAUZHACK_PYTHON": "py"}[k]
	}
	if got := StartupProblems(e); len(got) != 0 {
		t.Fatalf("tesseract on the PATH should count, got %q", got)
	}
}

func TestStartupProblemsNoRepository(t *testing.T) {
	e := checkEnv(map[string]string{"OPENROUTER_API_KEY": "k", "TOGETHER_API_KEY": "k"})
	e.Root = ""
	got := StartupProblems(e)
	if len(got) != 1 || !strings.Contains(got[0], "scanner/service.py was not found") {
		t.Fatalf("got %q", got)
	}
}
