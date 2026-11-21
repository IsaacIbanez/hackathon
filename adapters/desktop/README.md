# Gesture Control (desktop helper)

Owner: role C (Nil). A small local program that lets the hand gestures from `web/src/input` act on
the real computer: keyboard shortcuts, mouse, system volume and video-call controls.

It serves the gesture page and a local API on `127.0.0.1:8766`, protected by a token that changes
on every run (requests from other websites are rejected). It is separate from the Wails app.

## Run it
From the repository root:

```bash
cd web && npm ci && npx vite build src/input/desktop --outDir ../../../../adapters/desktop/dist --emptyOutDir && cd ..
```
```bash
go run ./adapters/desktop
```

It opens a small "Gesture Control" window (Chrome, Edge, Chromium or Brave, in a dedicated profile so
it keeps tracking while it is behind the call). Flags:

- `-dry-run`: log the actions instead of pressing anything (good for a first test).
- `-open=false`: don't open the window; open the printed URL yourself.
- `-screen 1920x1080`: screen size when it can't be detected (Linux Wayland without Hyprland).

To ship it as a single program: `go build -o gesture-control ./adapters/desktop` (on Windows,
`gesture-control.exe`). The page is embedded, so build the page first.

## What the gestures do
**Video call** mode (pick Google Meet, Zoom or Teams):

| Gesture | Action |
|---|---|
| ✋ open palm facing the camera, held | raise hand |
| 👍 thumbs up, held | mute / unmute |
| 👎 thumbs down, held | camera on / off |
| ✌️ menu ↓ | leave the call |
| ✌️ menu ↑, then 🤏 pinch and open | system volume (10 % steps; hold still to set it) |

**Computer** mode: 👍 Enter, ✋ Escape, swipe → next/previous tab, 👎 undo.
With **Move the mouse with ☝️**, pointing moves the cursor (the central part of the camera maps to
the whole screen) and holding still clicks.

The helper focuses the call window (by title) before sending the shortcut. If it can't, the shortcut
goes to whichever window is focused.

## Per system
- **Windows**: works out of the box (Windows API). Volume is set by pressing the volume keys.
- **Linux**: X11 needs `xdotool`. Wayland needs `wtype` (keys) and `ydotool` (mouse, with `ydotoold`
  running). Volume uses `wpctl`, `pactl` or `amixer`. Window focus works on X11, Hyprland and Sway.
- **macOS**: give the terminal the Accessibility permission (System Settings → Privacy & Security →
  Accessibility). The mouse needs `cliclick` (`brew install cliclick`).

## Known limits
- **Camera sharing**: the call app and this window both use the webcam. Windows 10/11 and macOS
  usually share it; on Linux it may be busy. If so, run with `-open=false` and open the URL as a
  separate window of the same browser the call runs in (Chrome shares the camera between its windows).
- Shortcuts are the apps' defaults and were not tested on every app version; check them in
  `shortcuts.go` if one doesn't work.
- Only tested with the dry run and automated tests so far, not yet on a real desktop.

## Files
- `main.go`: flags, server start, opening the window.
- `server.go`: the local API (`/api/status`, `/api/action`, `/api/pointer`) and the page.
- `executor.go`: turns an action into keys, mouse or volume; `DryRun` for tests.
- `shortcuts.go`: shortcuts per action, platform and call app.
- `desktop_{windows,linux,darwin}.go`: the real input on each system.
- The page lives in `web/src/input/desktop/` and is built into `dist/` (not committed).
