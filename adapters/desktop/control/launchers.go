package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

var idRegex = regexp.MustCompile(`^[a-z0-9_-]+$`)

// Launcher is an application that can be opened by ID from the gesture page.
type Launcher struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Open    string   `json:"open,omitempty"`    // URL, file, folder or app that the system opens with default handler
	Windows []string `json:"windows,omitempty"` // exact command for Windows (overrides open)
	Linux   []string `json:"linux,omitempty"`   // exact command for Linux (overrides open)
	Mac     []string `json:"mac,omitempty"`     // exact command for macOS (overrides open)
}

// LauncherInfo is what GET /api/status returns to the page (without executable commands).
type LauncherInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Argv returns the command-line arguments to launch the application on the given OS.
func (l Launcher) Argv(goos string) ([]string, error) {
	switch goos {
	case "windows":
		if len(l.Windows) > 0 {
			return l.Windows, nil
		}
		if l.Open != "" {
			return []string{"explorer.exe", l.Open}, nil
		}
	case "darwin":
		if len(l.Mac) > 0 {
			return l.Mac, nil
		}
		if l.Open != "" {
			return []string{"open", l.Open}, nil
		}
	case "linux":
		if len(l.Linux) > 0 {
			return l.Linux, nil
		}
		if l.Open != "" {
			return []string{"xdg-open", l.Open}, nil
		}
	default:
		if l.Open != "" {
			return []string{"open", l.Open}, nil
		}
	}
	return nil, fmt.Errorf("no command defined for launcher %q on %s", l.ID, goos)
}

// ValidateLaunchers checks that launchers have unique, valid IDs, non-empty names,
// and an open target or system command for the target OS (if specified).
func ValidateLaunchers(launchers []Launcher, goos string) ([]Launcher, error) {
	seen := make(map[string]bool)
	var valid []Launcher
	for _, l := range launchers {
		if !idRegex.MatchString(l.ID) {
			return nil, fmt.Errorf("invalid launcher id %q: must match [a-z0-9_-]", l.ID)
		}
		if seen[l.ID] {
			return nil, fmt.Errorf("duplicate launcher id %q", l.ID)
		}
		seen[l.ID] = true
		if l.Name == "" {
			return nil, fmt.Errorf("launcher %q has empty name", l.ID)
		}
		if goos != "" {
			if _, err := l.Argv(goos); err != nil {
				return nil, err
			}
		} else if l.Open == "" && len(l.Windows) == 0 && len(l.Linux) == 0 && len(l.Mac) == 0 {
			return nil, fmt.Errorf("launcher %q has no open target or command", l.ID)
		}
		valid = append(valid, l)
	}
	return valid, nil
}

// LoadLaunchers loads launchers from the first existing config file among:
// 1. flagPath (if given)
// 2. ./apps.json
// 3. adapters/desktop/apps.json
// 4. apps.json next to the executable
func LoadLaunchers(flagPath string, goos string) []Launcher {
	var candidates []string
	if flagPath != "" {
		candidates = append(candidates, flagPath)
	}
	candidates = append(candidates,
		"apps.json",
		filepath.Join("adapters", "desktop", "apps.json"),
	)
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "apps.json"))
	}

	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			log.Printf("warning: could not read launchers from %s: %v", path, err)
			continue
		}
		var raw []Launcher
		if err := json.Unmarshal(data, &raw); err != nil {
			log.Printf("warning: could not parse launchers from %s: %v", path, err)
			return nil
		}
		valid, err := ValidateLaunchers(raw, goos)
		if err != nil {
			log.Printf("warning: invalid launchers in %s: %v", path, err)
			return nil
		}
		return valid
	}
	return nil
}

// ToLauncherInfos converts launchers to a slice of LauncherInfo for the Status response.
func ToLauncherInfos(launchers []Launcher) []LauncherInfo {
	if len(launchers) == 0 {
		return []LauncherInfo{}
	}
	out := make([]LauncherInfo, len(launchers))
	for i, l := range launchers {
		out[i] = LauncherInfo{ID: l.ID, Name: l.Name}
	}
	return out
}

// openProcess starts a process asynchronously without blocking.
func openProcess(argv []string) error {
	if len(argv) == 0 {
		return errors.New("empty command")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
