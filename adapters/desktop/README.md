# Gesture Control (desktop program)

Owner: role C (Nil). A small local Go program that makes the hand gestures (`web/src/input`) act on the real computer: mouse control, keyboard, volume, brightness, microphone mute, system power and an app launcher.

It serves the camera window's page (`web/src/input/desktop/`) and a local API on `127.0.0.1:8767` (8766 is the scanner's), protected by a per-run token, a check of the `Host` header (against DNS rebinding) and verification of `Origin`. It is independent of the Wails app.

## Inside the overlay (a single executable)
The normal way is to use it as **overlay option 1** (`task overlay` → `build/bin/lauzhack.exe`, see `docs/OVERLAY.md`):
- the Wails app uses the `adapters/desktop/control` package inside its own process: there is no separate program, no port 8767 and no token;
- the camera page (`web/src/input/desktop/gestureControl.ts`, `mountGestureControl`) is mounted in the overlay's window, and its requests go to Go through the `GestureCall` binding, which answers the same API (`control.Server.Call`);
- with the gestures active, the overlay's shortcut (or **M**) shrinks the window to a **camera bubble** in a corner instead of hiding it; the shortcut or a double click restores it;
- options through environment variables: `LAUZHACK_GESTURES_DRY_RUN=1`, `LAUZHACK_SCREEN=1920x1080` and `LAUZHACK_APPS=<path to apps.json>`.

## Cursor mode (using the computer with the hand)
It is turned on from the menu (✊ → «🖱️ Cursor mode») or with the window's switch. Inside the overlay, turning it on moves the window aside to the bubble.
- ☝️ pointing moves the mouse: a small, high area of the image (`POINTER_AREA`, 46 % of the width and from 6 % to 50 % of the height) covers the whole screen, so the hand does not leave the frame when reaching the bottom; the gesture menu uses the same area;
- middle fingertip on the thumb: click; two quick taps: right click; holding: drag;
- ✋ open palm facing up or down: mouse wheel (scroll);
- «Keyboard» (first option of «Apps»): opens the on-screen keyboard to type with the mouse (Windows: `osk.exe`; Linux: `onboard`, if installed; macOS: opens the accessibility keyboard settings).

Without `apps.json`, «Apps» offers by default a browser, files, a calculator and a text editor.

## How to start it on its own (without the overlay)
`task gestures` builds `build/bin/gesture-control`. By hand, from the repository root:

```bash
cd web && npm ci && npx vite build src/input/desktop --outDir ../../../../adapters/desktop/dist --emptyOutDir && cd ..
```
```bash
go run ./adapters/desktop
```

It opens a small «Gesture Control» window (Chrome, Edge, Chromium or Brave, with its own profile so it keeps tracking the hand even when it is behind the video call). Options:

- `-dry-run`: only writes to the terminal what it would do, without pressing anything (for safe tests).
- `-open=false`: does not open the browser window; open the URL that appears yourself.
- `-apps <path>`: path to a custom `apps.json` file.
- `-screen 1920x1080`: screen size when it is not detected automatically (Linux Wayland without Hyprland).

To build it as a single executable binary:
```bash
go build -o gesture-control ./adapters/desktop
```
(On Windows: `gesture-control.exe`). The web interface is embedded in the binary, so it must be built first (`vite build`).

## Gesture detector and sleep mode
The detector starts **asleep** (`requireWake`) to prevent accidental gestures:
- It wakes up when a **strict open palm** is held ~1.2 s in front of the camera.
- The pose is demanding: all 5 fingers extended and straight (straightness ≥ 0.93), fingers spread (index–little finger spread ≥ 0.8), the palm facing the camera and the hand upright (tilt ≤ 40°).
- The screen shows contextual hints (`wakeHint`) saying what to correct: `"open"`, `"straight"`, `"spread"`, `"facing"` or `"upright"`.
- After a period of inactivity with no gestures or mouse movement, it goes back to sleep automatically.

## Fist quick menu (✊) and pages
The menu is shown on a 3×3 screen grid (with the centre empty):
- **Open and close:** a ✊ fist held still ~0.5 s opens the main menu. Inside the menu, releasing the fist and showing ✊ again for ~0.5 s closes it. It also closes on its own after 5 s of inactivity.
- **Going back (navigation):** a thumbs down 👎 held ~0.3 s or a lateral swipe ✋← goes back a page in the menu (or closes it from the main page).
- **Main page:**
  - ↑ 🔊 Volume and ↓ 🔆 Brightness: turn on the pinch level control (🤏 opening or closing the thumb and index fingers, set by holding still).
  - ↖ Main menu: goes back to the overlay's main menu (the large options) without turning the gestures off; from the bubble, the window goes back to its size. With cursor mode an option can be chosen there.
  - ← Close app (in red): closes the whole application.
  - ↙ Microphone: toggle of the system microphone (`mic_mute`). Choosing it does not close the menu; the option changes to «Mic: muted» or «Mic: on».
  - ↗ Cursor mode: turns mouse-by-gesture on or off.
  - → Apps ▸: opens the applications submenu (first the on-screen keyboard and, in a video call, «Raise hand»).
  - ↘ Computer ▸: opens the power options submenu (only if allowed).
- **Computer submenu:**
  - Options: ↑ Suspend…, ← Restart…, → Shut down… and ↓ Back.
  - All the shut down/restart options require a confirmation first.
- **Power confirmation page:**
  - A menu simplified to only 2 options: ↑ ↩ Back (back to Computer) and ↓ ✔ Yes, <action> (confirms the action).
  - For safety, only the bottom cell confirms the action.
  - The chosen cell is temporarily blocked so that the new screen does not trigger options by accident when the page changes.
- **Apps submenu:**
  - Opens up to 7 applications configured in `apps.json` spread over the available cells (`APP_CELLS`), with ↓ Back. If there are no apps configured, it shows gaps («App N · not set»).

## Mouse control with the hand
With the **«Move the mouse with ☝️»** checkbox ticked (on by default):
- **Move the cursor:** pointing with the index finger ☝️ moves the cursor smoothly (a mapping with a margin to reach the corners without leaving the camera's frame).
- **Left click:** done only by joining the middle fingertip (heart finger) and the thumb while pointing. Holding still never clicks (holding still only confirms gestures such as waking up or setting the volume/brightness).
- **Right click:** two quick taps in a row with the middle finger on the thumb.
- **Drag:** keep the middle finger and the thumb together while moving the index finger.
- **Drag (holding down):** join the middle finger and the thumb and keep them together for more than 300 ms (emits `mouse down`). When the fingers separate, the button is released (`mouse up`).
- **No gesture conflict:** the victory gesture (✌️) has been removed completely because it looked like the click pose; two raised fingers count as resting pointing.

## Configurable applications (`apps.json`)
The list of applications is configured through a local JSON file. The web page only knows the identifiers (`id`) and names (`name`), which prevents the browser from running arbitrary commands.

`apps.json` search order:
1. The `-apps <path>` parameter
2. `./apps.json`
3. `adapters/desktop/apps.json`
4. Next to the executable

Example (`adapters/desktop/apps.example.json`):
```json
[
  {
    "id": "browser",
    "name": "Browser",
    "open": "https://lauzhack.com"
  },
  {
    "id": "files",
    "name": "File Manager",
    "open": "."
  },
  {
    "id": "calculator",
    "name": "Calculator",
    "windows": ["calc.exe"],
    "linux": ["gnome-calculator"],
    "mac": ["open", "-a", "Calculator"]
  }
]
```

## Requirements and support per operating system

### Windows
- Works without additional external tools (it uses `user32.dll` and calls to PowerShell 5.1).
- **Mouse:** `user32.dll` events (`mouse_event`).
- **Brightness:** set through WMI (`WmiMonitorBrightnessMethods`).
- **Microphone:** a C# script in PowerShell working with CoreAudio's COM interfaces (`MMDeviceEnumerator` and `IAudioEndpointVolume`).
- **Power:** `shutdown /s /t 0`, `shutdown /r /t 0`, and `SetSuspendState` in Forms to suspend.

### Linux
- **Keyboard and mouse:**
  - On **X11**: requires `xdotool` (`xdotool mousedown 1`, `xdotool mouseup 1`, `xdotool click 3`).
  - On **Wayland**: requires `wtype` (keys) and `ydotool` (mouse, with `ydotoold` running; clicks with `0x40`, `0x80` and `0xC1`).
- **Brightness:** uses `brightnessctl set N%`, `light -S N` or `xrandr --output <display> --brightness <v>`.
- **Microphone:** uses `wpctl set-mute`, `pactl set-source-mute` or `amixer sset Capture toggle`.
- **Power:** `systemctl suspend`, `systemctl reboot`, `systemctl poweroff`.
- **Active window:** focuses calls through `hyprctl` (Hyprland), `swaymsg` (Sway) or `xdotool` (X11).

### macOS
- Give the terminal the Accessibility permission (System Settings → Privacy & Security → Accessibility).
- **Mouse:** requires `cliclick` (`brew install cliclick`).
- **Brightness:** uses the `brightness` tool (`brew install brightness`) if present, or the brightness keys through AppleScript.
- **Microphone:** sets and restores the input volume (`input volume`) through AppleScript.
- **Power:** `pmset sleepnow` (suspend), or AppleScript to restart and shut down through System Events.

## Local API endpoints
All calls require the `X-Gesture-Token` header with the token generated at startup, and they validate the `Host` and `Origin` headers:
- `GET /api/status`: returns the platform, desktop driver, dryRun mode, the list of call apps and launchers (`launchers: [{id, name}]`) without revealing internal commands.
- `POST /api/action`: runs a system action (`Request{action, value, app, confirm, target}`). Power actions require `confirm: true` (error 428 if missing).
- `POST /api/mouse`: handles the mouse buttons with `{action: "down" | "up" | "click" | "right_click"}`, guaranteeing sequential order in a queue.
- `POST /api/pointer`: updates the pointer's position `{x, y}` normalised to [0, 1].
- `GET /api/mic`: the real state of the system microphone (`{"muted": true|false}`).

## Known limits
- **External screens:** brightness control is limited to internal laptop screens or primary outputs supported by the system's drivers (it does not support DDC/CI for external desktop monitors).
- **Tests on real hardware:** the implementation has been validated thoroughly with unit tests and in `-dry-run` mode, but the physical hardware actions (real shut down, suspend, specific microphones) must be supervised in each environment.
- **Shared camera:** if a video call takes exclusive access to the webcam on Linux, start with `-open=false` and open the web interface in a tab of the same browser to share the stream.
