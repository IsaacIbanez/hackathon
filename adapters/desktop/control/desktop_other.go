//go:build !linux && !windows && !darwin

package control

type otherDesktop struct{}

func NewDesktop(_, _ int) Desktop { return otherDesktop{} }

func (otherDesktop) Name() string                   { return "unsupported system" }
func (otherDesktop) PressKeys(Combo) error          { return ErrUnsupported }
func (otherDesktop) MoveMouse(_, _ float64) error   { return ErrUnsupported }
func (otherDesktop) Click() error                   { return ErrUnsupported }
func (otherDesktop) MouseDown() error               { return ErrUnsupported }
func (otherDesktop) MouseUp() error                 { return ErrUnsupported }
func (otherDesktop) RightClick() error              { return ErrUnsupported }
func (otherDesktop) SetVolume(float64) error        { return ErrUnsupported }
func (otherDesktop) SetBrightness(float64) error    { return ErrUnsupported }
func (otherDesktop) ToggleMicMute() (string, error) { return "", ErrUnsupported }
func (otherDesktop) Power(string) error             { return ErrUnsupported }
func (otherDesktop) OpenApp([]string) error         { return ErrUnsupported }
func (otherDesktop) FocusWindow(CallApp) error      { return ErrUnsupported }
