//go:build !linux && !windows && !darwin

package main

type otherDesktop struct{}

func newDesktop(_, _ int) Desktop { return otherDesktop{} }

func (otherDesktop) Name() string                 { return "unsupported system" }
func (otherDesktop) PressKeys(Combo) error        { return ErrUnsupported }
func (otherDesktop) MoveMouse(_, _ float64) error { return ErrUnsupported }
func (otherDesktop) Click() error                 { return ErrUnsupported }
func (otherDesktop) SetVolume(float64) error      { return ErrUnsupported }
func (otherDesktop) FocusWindow(CallApp) error    { return ErrUnsupported }
