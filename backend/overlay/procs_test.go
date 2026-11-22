package overlay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func serviceAnswering(t *testing.T, health string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_, _ = w.Write([]byte(health))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("SCANNER_URL", srv.URL+"/scan")
}

func TestEnsureUsesAServiceOfTheRightVersion(t *testing.T) {
	serviceAnswering(t, `{"ok": true, "api": 3}`)
	if err := NewReadingService().Ensure(context.Background()); err != nil {
		t.Fatalf("Ensure = %v, want nil", err)
	}
}

// An old scanner/service.py left running on the port (started by hand) answers /health but lacks the
// new routes: the app used to take it and then fail. It is refused, with what to do, and never killed.
func TestEnsureRefusesAnOldService(t *testing.T) {
	serviceAnswering(t, `{"ok": true, "tesseract": "5.4"}`)
	err := NewReadingService().Ensure(context.Background())
	if !errors.Is(err, errStaleService) {
		t.Fatalf("Ensure = %v, want the stale service message", err)
	}
	if !strings.Contains(err.Error(), "Close it") {
		t.Errorf("the message must say what to do: %v", err)
	}
}

func TestWhyItDiedSaysWhatToDo(t *testing.T) {
	cases := map[string]string{
		"Traceback ...\nModuleNotFoundError: No module named 'cv2'\n":     InstallScannerCommand,
		"OSError: [WinError 10048] Only one usage of each socket address": "port 8770 is taken",
		"something else": "details in x.log",
	}
	for logTail, want := range cases {
		if got := whyItDied(logTail, "x.log").Error(); !strings.Contains(got, want) {
			t.Errorf("whyItDied(%q) = %q, want it to contain %q", logTail, got, want)
		}
	}
}

func TestHasScannerEnv(t *testing.T) {
	root := t.TempDir()
	if hasScannerEnv(root) {
		t.Fatal("empty folder: no environment")
	}
	venv := filepath.Join(root, "scanner", "pdf", ".venv", "Scripts")
	if err := os.MkdirAll(venv, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(venv, "python.exe"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if !hasScannerEnv(root) {
		t.Fatal("python.exe in scanner/pdf/.venv/Scripts: environment present")
	}
}
