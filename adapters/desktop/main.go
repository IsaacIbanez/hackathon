// Gesture Control: a small local program that lets the hand gestures recognized in the browser
// (web/src/input) act on the real computer — keyboard shortcuts, mouse, system volume, brightness,
// microphone mute, power controls and launchers.
//
// It serves the gesture page and a local API on 127.0.0.1 only, protected by a per-run token.
//
//	go run ./adapters/desktop            # opens the gesture window
//	go run ./adapters/desktop -dry-run   # logs the actions instead of performing them
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed all:dist
var dist embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8767", "address to listen on (keep it on 127.0.0.1)")
	open := flag.Bool("open", true, "open the gesture window")
	dryRun := flag.Bool("dry-run", false, "log the actions instead of performing them")
	screen := flag.String("screen", "", "screen size WIDTHxHEIGHT when it can't be detected (Linux Wayland)")
	appsFile := flag.String("apps", "", "path to apps.json configuration file")
	flag.Parse()

	host, _, err := net.SplitHostPort(*addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatalf("refusing to listen on %q: use 127.0.0.1 so only this computer can send actions", *addr)
	}
	w, h := parseScreen(*screen)

	var desktop Desktop
	if *dryRun {
		desktop = &DryRun{}
	} else {
		desktop = newDesktop(w, h)
	}

	launchers := LoadLaunchers(*appsFile, runtime.GOOS)

	assets, err := fs.Sub(dist, "dist")
	if err != nil {
		log.Fatal(err)
	}
	srv := &Server{
		Exec: &Executor{
			Desktop:    desktop,
			GOOS:       runtime.GOOS,
			FocusDelay: 250 * time.Millisecond,
			Launchers:  launchers,
		},
		Token:  newToken(),
		Assets: assets,
		Status: Status{
			Platform:  runtime.GOOS,
			Desktop:   desktop.Name(),
			DryRun:    *dryRun,
			Apps:      CallApps,
			Launchers: ToLauncherInfos(launchers),
		},
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen on %s: %v (is Gesture Control already running?)", *addr, err)
	}
	_, srv.Port, _ = net.SplitHostPort(ln.Addr().String())
	url := "http://" + ln.Addr().String() + "/"
	log.Printf("Gesture Control on %s — acting through: %s", url, desktop.Name())
	if *open {
		if err := openAppWindow(url); err != nil {
			log.Printf("could not open a browser window (%v): open %s yourself", err, url)
		}
	}
	log.Fatal(http.Serve(ln, srv.Handler()))
}

func newToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(b)
}

func parseScreen(s string) (int, int) {
	if s == "" {
		return 0, 0
	}
	parts := strings.SplitN(strings.ToLower(s), "x", 2)
	if len(parts) != 2 {
		log.Fatalf("invalid -screen %q, expected WIDTHxHEIGHT", s)
	}
	w, err1 := strconv.Atoi(parts[0])
	h, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		log.Fatalf("invalid -screen %q, expected WIDTHxHEIGHT", s)
	}
	return w, h
}

// screenPixels converts normalized coordinates to pixels.
func screenPixels(x, y float64, w, h int) (int, int) {
	return int(x*float64(w-1) + 0.5), int(y*float64(h-1) + 0.5)
}
