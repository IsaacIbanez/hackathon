package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// openAppWindow opens the gesture page in its own small Chromium-based window (Chrome, Edge,
// Chromium, Brave). It uses a dedicated profile so the flags below apply: the page keeps running
// when the window is in the background or covered by the video call. Falls back to the default
// browser.
func openAppWindow(url string) error {
	if bin := findChromium(); bin != "" {
		profile := filepath.Join(os.TempDir(), "gesture-control-browser")
		if dir, err := os.UserConfigDir(); err == nil {
			profile = filepath.Join(dir, "gesture-control", "browser")
		}
		cmd := exec.Command(bin,
			"--app="+url,
			"--user-data-dir="+profile,
			"--window-size=480,720",
			"--no-first-run",
			"--no-default-browser-check",
			// Keep tracking the hand while the window is in the background.
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			// Grant the camera without a prompt (only in this dedicated profile).
			"--use-fake-ui-for-media-stream",
		)
		if err := cmd.Start(); err == nil {
			return nil
		}
	}
	return openDefaultBrowser(url)
}

func findChromium() string {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
			if base == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`),
			)
		}
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		}
	default:
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func openDefaultBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
