package overlay

import (
	"path/filepath"
)

// Start-up checks (demo polish, docs/demo/ISAAC.md): what a tool needs and is missing on this
// computer, each with what to do about it. The menu shows them, so nothing fails in silence during
// the demo. Pure: everything it looks at comes in CheckEnv (tested in checks_test.go).

// CheckEnv is what the checks look at.
type CheckEnv struct {
	Getenv   func(string) string
	Exists   func(path string) bool
	LookPath func(file string) (string, error)
	Root     string // the repository (RepoRoot); "" when scanner/service.py is not next to the app
	GOOS     string
}

// TesseractWindowsPaths are where the installer puts Tesseract (scanner_pdf/ocr.py WINDOWS_PATHS).
var TesseractWindowsPaths = []string{`C:\Program Files\Tesseract-OCR\tesseract.exe`, `C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`}

// InstallScannerCommand installs the scanner's Python environment, Tesseract and its languages.
const InstallScannerCommand = `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1`

// StartupProblems lists what is missing, in the order a person would fix it.
func StartupProblems(e CheckEnv) []string {
	var out []string
	if e.Getenv("OPENROUTER_API_KEY") == "" {
		out = append(out, "No OPENROUTER_API_KEY in .env: AI Summary, voice commands and the AI version of PDF Scanner will not work.")
	}
	if e.Getenv("TOGETHER_API_KEY") == "" {
		out = append(out, "No TOGETHER_API_KEY in .env: Transcribe will not work.")
	}
	if e.Getenv("SCANNER_URL") == "fixture" {
		return out // sample answers: no reading service, nothing else to check
	}
	if e.Root == "" {
		return append(out, "scanner/service.py was not found next to the app: PDF Scanner and Read Text cannot start. Run the app from the repository (build/bin).")
	}
	if e.Getenv("LAUZHACK_PYTHON") == "" {
		venv := filepath.Join(e.Root, "scanner", "pdf", ".venv", "bin", "python")
		if e.GOOS == "windows" {
			venv = filepath.Join(e.Root, "scanner", "pdf", ".venv", "Scripts", "python.exe")
		}
		if !e.Exists(venv) {
			out = append(out, "PDF Scanner is not installed on this computer. Run once: "+InstallScannerCommand)
		}
	}
	if !tesseractFound(e) {
		out = append(out, "Tesseract (the text reader) is not installed: PDF Scanner cannot read. Run once: "+InstallScannerCommand)
	}
	return out
}

func tesseractFound(e CheckEnv) bool {
	if p := e.Getenv("TESSERACT_CMD"); p != "" {
		return e.Exists(p)
	}
	if _, err := e.LookPath("tesseract"); err == nil {
		return true
	}
	if e.GOOS == "windows" {
		for _, p := range TesseractWindowsPaths {
			if e.Exists(p) {
				return true
			}
		}
	}
	return false
}
