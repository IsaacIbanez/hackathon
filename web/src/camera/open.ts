// openCamera: opens one camera stream, preferring the Logitech webcam (MX Brio) by label.

import { pickCamera, type CameraInfo } from './select.ts'

export interface OpenCameraOptions {
  /** Requested size; the camera delivers the closest it supports. Default 3840x2160 (text must be legible). */
  width?: number
  height?: number
  frameRate?: number
  /** Use the first camera whose label matches (instead of the Logitech one). */
  prefer?: RegExp
  /** Open exactly this device. */
  deviceId?: string
}

const DEFAULTS = { width: 3840, height: 2160, frameRate: 30 }

function videoConstraints(opts: OpenCameraOptions, deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    width: { ideal: opts.width ?? DEFAULTS.width },
    height: { ideal: opts.height ?? DEFAULTS.height },
    frameRate: { ideal: opts.frameRate ?? DEFAULTS.frameRate },
  }
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

async function listCameras(): Promise<CameraInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }))
}

function open(opts: OpenCameraOptions, deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: videoConstraints(opts, deviceId), audio: false })
}

function streamDeviceId(stream: MediaStream): string | undefined {
  return stream.getVideoTracks()[0]?.getSettings().deviceId
}

/**
 * Opens the camera. Prefers the Logitech one (MX Brio) if it is connected; otherwise, whichever there is.
 *
 * Labels are only visible after camera permission, so if they are empty the default camera is
 * opened first and, if a Logitech camera then shows up, the stream is switched to it.
 */
export async function openCamera(opts: OpenCameraOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available in this window (no getUserMedia)')
  if (opts.deviceId) return open(opts, opts.deviceId)

  const known = pickCamera(await listCameras(), opts.prefer)
  if (known) return open(opts, known.deviceId)

  const stream = await open(opts)
  const preferred = pickCamera(await listCameras(), opts.prefer)
  if (!preferred || preferred.deviceId === streamDeviceId(stream)) return stream
  stream.getTracks().forEach((t) => t.stop())
  return open(opts, preferred.deviceId)
}

/** Label and delivered size of the stream, for logs and diagnostics. */
export function describeStream(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0]
  if (!track) return 'no video track'
  const s = track.getSettings()
  return `${track.label || 'camera'} ${s.width ?? '?'}x${s.height ?? '?'} @ ${s.frameRate ? Math.round(s.frameRate) : '?'} fps`
}
