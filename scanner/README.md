# scanner/ — document capture (role B1, Pau)

An isolated Python prototype: captures the webcam's full frame (Logitech MX Brio) on command.
Rules of the folder: `scanner/AGENTS.md`. In the app, `web/src/camera` takes the photo; this program is for tests and for `scanner/benchmark/`.

## Installation (once)
```
python -m venv scanner/.venv
scanner/.venv/Scripts/python -m pip install -r scanner/requirements.txt   # Linux/macOS: scanner/.venv/bin/python
```
To see the cameras' names on Windows, `ffmpeg` is needed on the PATH (on Linux they are read from `/sys`).

## Usage
The command-line flags keep their original (Spanish) names, since other scripts use them.
```
scanner/.venv/Scripts/python scanner/capturar.py --listar      # list the available cameras
scanner/.venv/Scripts/python scanner/capturar.py               # capture with the MX Brio
scanner/.venv/Scripts/python scanner/capturar.py --camara 0    # another camera (index or part of the name)
scanner/.venv/Scripts/python scanner/capturar.py --probar      # check the camera without saving
scanner/.venv/Scripts/python scanner/capturar.py --json        # result as JSON (for integrating)
```

### Server mode (captures in ~0.4 s)
```
scanner/.venv/Scripts/python scanner/capturar.py --servidor    # keeps the camera open (Ctrl+C to quit)
curl http://127.0.0.1:8766/captura                             # capture -> {"ok":true,"png":...,"json":...}
curl http://127.0.0.1:8766/estado                              # current fps and sharpness
```
It only listens on `127.0.0.1`. While it is open the camera stays on and decodes 4K (~20 fps), with some CPU.
Each capture uses the sharpest frame of those that arrive **after** the command (about 0.15 s); if the autofocus is
readjusting, it waits up to 1 s for it to recover.

### What it does and how long it takes (MX Brio, Windows 11)
- Saves to `scanner/capturas/YYYYMMDD-HHMMSS-mmm.png` (lossless, uncropped) and a `.json` with the metadata:
  camera, requested and delivered resolution, format, focus and exposure settings, and how the frame was chosen (sharpness).
  `capturas/` is in `.gitignore`: they are real documents.
- Asks for 3840x2160 in MJPG; the camera delivers what it can, and what is delivered goes into the JSON. 4K is not taken for granted.
  The settings are passed when opening the camera: with `cap.set()` each one restarts the stream and the format stays in YUY2 (~5 fps).
- It does not use a fixed wait: the MX Brio readjusts the autofocus between 1.1 and 1.25 s after the first frame when the
  scene has changed. The script waits for that readjustment (or at most `--calentamiento`, 1.4 s) and saves the
  **sharpest** of the last frames (variance of the Laplacian), never one in the middle of the readjustment.
- Single capture: the PNG's path comes out at ~2.7 s; the process ends ~0.7 s later because closing the camera in
  DirectShow takes ~0.9 s (done in parallel with the saving). Server mode: ~0.4 s per capture.
- If it does not find the Brio, it fails (code 2) instead of silently using another camera. Codes: 0 ok, 2 not found,
  3 cannot open, 4 no frame. Settings at `-1` mean the backend does not expose them.

## Tests (no camera)
```
scanner/.venv/Scripts/python -m unittest discover -s scanner
```
