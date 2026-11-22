package control

import (
	"runtime"
	"time"
)

// Options configure a Server built with New.
type Options struct {
	DryRun bool   // log the actions instead of performing them
	Width  int    // screen size when it can't be detected (0: detect)
	Height int    //
	Apps   string // path to apps.json ("" searches the usual places, see LoadLaunchers)
	// AllowPower enables suspend, restart and shut down (off by default, see Executor.AllowPower).
	AllowPower bool
}

// New builds a Server that acts on this computer (or only logs, with DryRun). Assets, Token and
// Port are only needed to serve the page over HTTP (the standalone program).
func New(o Options) *Server {
	var desktop Desktop
	if o.DryRun {
		desktop = &DryRun{}
	} else {
		desktop = NewDesktop(o.Width, o.Height)
	}
	launchers := LoadLaunchers(o.Apps, runtime.GOOS)
	return &Server{
		Exec: &Executor{
			Desktop:    desktop,
			GOOS:       runtime.GOOS,
			FocusDelay: 250 * time.Millisecond,
			Launchers:  launchers,
			AllowPower: o.AllowPower,
		},
		Status: Status{
			Platform:  runtime.GOOS,
			Desktop:   desktop.Name(),
			DryRun:    o.DryRun,
			Apps:      CallApps,
			Launchers: ToLauncherInfos(launchers),
			Power:     o.AllowPower,
		},
	}
}
