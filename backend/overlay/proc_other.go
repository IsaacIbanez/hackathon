//go:build !windows

package overlay

import (
	"os/exec"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {
	// Own process group, so killTree can end the children too.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func killTree(pid int) {
	_ = syscall.Kill(-pid, syscall.SIGTERM)
}
