package overlay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// RepoRoot finds the repository (the folder with scanner/service.py) from the executable's folder
// or the working directory, going up to 4 levels: build/bin/lauzhack.exe → the repo root.
func RepoRoot() string {
	var starts []string
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, dir := range starts {
		for i := 0; i <= 4; i++ {
			if _, err := os.Stat(filepath.Join(dir, "scanner", "service.py")); err == nil {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return ""
}

// exeDir is the folder of the running executable (logs of the helper processes go there).
func exeDir() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return "."
}

// Process is a helper program the overlay starts and stops (output to a log next to the exe).
type Process struct {
	Name string
	mu   sync.Mutex
	cmd  *exec.Cmd
	done chan struct{}
}

// Running says whether this overlay started the process and it has not exited.
func (p *Process) Running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd == nil {
		return false
	}
	select {
	case <-p.done:
		return false
	default:
		return true
	}
}

func (p *Process) start(dir, bin string, args ...string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd != nil {
		select {
		case <-p.done:
		default:
			return nil // already running
		}
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = dir
	hideWindow(cmd)
	logPath := filepath.Join(exeDir(), p.Name+".log")
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
		fmt.Fprintf(f, "---- %s %s %s\n", time.Now().Format(time.RFC3339), bin, strings.Join(args, " "))
		cmd.Stdout, cmd.Stderr = f, f
	} else {
		cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s: %w", p.Name, err)
	}
	done := make(chan struct{})
	go func() {
		err := cmd.Wait()
		log.Printf("overlay: %s exited: %v", p.Name, err)
		if c, ok := cmd.Stdout.(io.Closer); ok {
			_ = c.Close()
		}
		close(done)
	}()
	p.cmd, p.done = cmd, done
	log.Printf("overlay: started %s (pid %d): %s %s", p.Name, cmd.Process.Pid, bin, strings.Join(args, " "))
	return nil
}

// Stop ends the process and everything it opened (Gesture Control's browser window, OCR workers).
func (p *Process) Stop() {
	p.mu.Lock()
	cmd, done := p.cmd, p.done
	p.cmd = nil
	p.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	killTree(cmd.Process.Pid)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
	}
}

// ---- Reading service (role B2, Python): scanner/service.py on 127.0.0.1:8770 ----

// ReadingServiceURL is the service's base URL (SCANNER_URL without its /scan path).
func ReadingServiceURL() string {
	u := os.Getenv("SCANNER_URL")
	if u == "" || u == "fixture" {
		u = "http://127.0.0.1:8770/scan"
	}
	return strings.TrimSuffix(strings.TrimRight(u, "/"), "/scan")
}

// ReadingService starts scanner/service.py when it is not already answering.
type ReadingService struct {
	Process
}

func NewReadingService() *ReadingService {
	return &ReadingService{Process{Name: "reading-service"}}
}

// ReadingServiceAPI is the version of the reading service's routes this app needs (SERVICE_API in
// scanner/service.py). An older service still answering on the port lacks routes the app calls.
const ReadingServiceAPI = 3

// Healthy says whether a reading service of the right version answers GET /health.
func (s *ReadingService) Healthy(ctx context.Context) bool {
	up, api := s.health(ctx)
	return up && api >= ReadingServiceAPI
}

// health: whether something answers GET /health on the service's address, and its route version
// (0 for services from before the version was reported).
func (s *ReadingService) health(ctx context.Context) (bool, int) {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ReadingServiceURL()+"/health", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, 0
	}
	var h struct {
		API int `json:"api"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&h)
	return true, h.API
}

// Messages for the person: what happened and what to do (shown on the PDF Scanner screen).
var (
	errStaleService = errors.New("an older reading service is answering on port 8770 (one started by hand before an update). " +
		"Close it (the terminal running scanner/service.py) or restart the computer, then try again")
	errScannerNotInstalled = errors.New("the scanner is not installed on this computer. In the project folder run, once: " +
		InstallScannerCommand + " — then try again")
)

// whyItDied explains a start-up failure from the end of the service's log.
func whyItDied(logTail, logPath string) error {
	switch {
	case strings.Contains(logTail, "No module named"):
		return errScannerNotInstalled
	case strings.Contains(logTail, "Address already in use"), strings.Contains(logTail, "WinError 10048"):
		return errors.New("port 8770 is taken by another program. Close it or restart the computer, then try again")
	default:
		return fmt.Errorf("the reading service stopped while starting (details in %s)", logPath)
	}
}

func tail(path string, n int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Size() > n {
		_, _ = f.Seek(st.Size()-n, io.SeekStart)
	}
	b, _ := io.ReadAll(f)
	return string(b)
}

// Ensure makes sure the service answers: if it does not, it starts it with the repository's Python
// and waits up to 30 s (loading OpenCV and Tesseract takes a few seconds).
func (s *ReadingService) Ensure(ctx context.Context) error {
	if os.Getenv("SCANNER_URL") == "fixture" {
		return nil
	}
	up, api := s.health(ctx)
	if up && api >= ReadingServiceAPI {
		return nil
	}
	if up && !s.Running() {
		return errStaleService // not ours: never kill another program's process
	}
	root := RepoRoot()
	if root == "" {
		return errors.New("reading service not running and scanner/service.py not found next to the app")
	}
	py, pyArgs := pythonCommand(root)
	if !hasScannerEnv(root) && os.Getenv("LAUZHACK_PYTHON") == "" {
		// The system's Python has no OpenCV: it would die with "No module named cv2".
		return errScannerNotInstalled
	}
	args := append(pyArgs, "-u", filepath.Join("scanner", "service.py"))
	if err := s.start(root, py, args...); err != nil {
		return err
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if s.Healthy(ctx) {
			return nil
		}
		if !s.Running() {
			logPath := filepath.Join(exeDir(), s.Name+".log")
			return whyItDied(tail(logPath, 4096), logPath)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return errors.New("reading service did not answer in 30 s")
}

// hasScannerEnv says whether the scanner's virtualenv (install.ps1 / install.sh) exists.
func hasScannerEnv(root string) bool {
	for _, p := range []string{filepath.Join("scanner", "pdf", ".venv", "Scripts", "python.exe"), filepath.Join("scanner", "pdf", ".venv", "bin", "python")} {
		if _, err := os.Stat(filepath.Join(root, p)); err == nil {
			return true
		}
	}
	return false
}

// pythonCommand picks the interpreter: LAUZHACK_PYTHON, the scanner's virtualenv, then the
// system's Python launcher.
func pythonCommand(root string) (string, []string) {
	if p := os.Getenv("LAUZHACK_PYTHON"); p != "" {
		return p, nil
	}
	venv := filepath.Join(root, "scanner", "pdf", ".venv", "bin", "python")
	if runtime.GOOS == "windows" {
		venv = filepath.Join(root, "scanner", "pdf", ".venv", "Scripts", "python.exe")
	}
	if _, err := os.Stat(venv); err == nil {
		return venv, nil
	}
	if runtime.GOOS == "windows" {
		if p, err := exec.LookPath("py"); err == nil {
			return p, []string{"-3"}
		}
	}
	if p, err := exec.LookPath("python3"); err == nil {
		return p, nil
	}
	return "python", nil
}
