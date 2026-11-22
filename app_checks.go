package main

import (
	"log"
	"os"
	"os/exec"
	"runtime"

	"github.com/IsaacIbanez/hackathon/backend/llm"
	"github.com/IsaacIbanez/hackathon/backend/overlay"
)

// checkStartup finds what a tool needs and is missing on this computer (keys, the scanner, a second
// copy of the app) and keeps it for the menu, which shows each problem with what to do
// (docs/demo/ISAAC.md). Everything is also written to lauzhack.log.
func (a *App) checkStartup(another bool) {
	for _, p := range llm.DotEnvCandidates() {
		llm.LoadDotEnv(p) // the same .env the models and Transcribe read
	}
	build := overlay.Build()
	log.Printf("version: %s", build)
	var problems []string
	if another {
		problems = append(problems, "Another copy of the app is already open. Close one of them: both fight for the keypad, the shortcuts and the camera.")
	}
	problems = append(problems, overlay.StartupProblems(overlay.CheckEnv{
		Getenv:   os.Getenv,
		Exists:   fileExists,
		LookPath: exec.LookPath,
		Root:     overlay.RepoRoot(),
		GOOS:     runtime.GOOS,
	})...)
	if len(problems) == 0 {
		log.Printf("startup: everything the tools need is here")
	}
	for _, p := range problems {
		log.Printf("startup: %s", p)
	}
	a.overlay.mu.Lock()
	a.overlay.problems = problems
	a.overlay.build = build
	a.overlay.mu.Unlock()
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
