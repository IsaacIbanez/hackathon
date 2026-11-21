package llm

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// LoadDotEnv reads KEY=value lines from a file (usually .env, which is gitignored) and
// sets them in the environment unless they are already set. It does nothing if the file
// does not exist. Blank lines and comments (#) are skipped; surrounding single or double
// quotes are removed from the value.
func LoadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}

// DotEnvCandidates returns where NewFromEnv looks for .env, in priority order: the current
// directory, then the executable's directory and up to three parents (so a desktop build in
// build/bin, started with a double click, still finds the .env at the repository root).
func DotEnvCandidates() []string {
	paths := []string{".env"}
	exe, err := os.Executable()
	if err != nil {
		return paths
	}
	dir := filepath.Dir(exe)
	for range 4 {
		paths = append(paths, filepath.Join(dir, ".env"))
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return paths
}
