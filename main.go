// Desktop app (Wails). Frontend in web/ (React + Vite + TS + Tailwind).
// Development: task dev. Without a window: task mock + npm run dev in web/.
package main

import (
	"embed"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:web/dist
var assets embed.FS

func main() {
	logToFile()
	app := NewApp()

	err := wails.Run(&options.App{
		// Overlay (docs/OVERLAY.md): always on top; Ctrl+Alt+Space (or an MX Keypad key) shows and hides it.
		Title:       "LauzHack overlay",
		Width:       overlayWidth,
		Height:      overlayHeight,
		AlwaysOnTop: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 23, B: 42, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

// logToFile also writes the log to lauzhack.log next to the executable: a desktop build has
// no console, and this is where to look when something fails during the demo.
func logToFile() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(filepath.Dir(exe), "lauzhack.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	// The file first: a desktop build has no valid stderr, and io.MultiWriter stops at the first
	// writer that fails (before this, the log stayed empty in build/bin/lauzhack.exe).
	log.SetOutput(io.MultiWriter(f, os.Stderr))
	// A crash (panic) is written there too, instead of disappearing with the missing console.
	_ = debug.SetCrashOutput(f, debug.CrashOptions{})
	log.Printf("---- start (%s)", exe)
}
