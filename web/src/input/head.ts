// Head gestures (experimental): nod and shake, from MediaPipe FaceLandmarker landmarks.
// Meant for people who cannot use their hands.

import type { Face, HeadGesture } from "./types.ts";

// Indices in MediaPipe's 478-point face mesh.
const NOSE = 1;
const FOREHEAD = 10;
const CHIN = 152;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;

export interface HeadOptions {
  /** Time window in which to look for the back-and-forth movement. */
  windowMs: number;
  /** Minimum movement amplitude, relative to face size. */
  amplitude: number;
  /** How much the gesture's axis must dominate the other axis. */
  dominance: number;
  /** Pause after a head gesture. */
  cooldownMs: number;
}

export const HEAD_DEFAULTS: HeadOptions = {
  windowMs: 1200,
  amplitude: 0.12,
  dominance: 1.8,
  cooldownMs: 1200,
};

export class HeadGestureDetector {
  private options: HeadOptions;
  private history: { t: number; x: number; y: number }[] = [];
  private tLast = -Infinity;

  constructor(options: Partial<HeadOptions> = {}) {
    this.options = { ...HEAD_DEFAULTS, ...options };
  }

  /** Returns a head gesture if one was just completed in this frame. */
  process(t: number, face: Face | null | undefined): HeadGesture | null {
    if (!face || face.points.length < 455) {
      this.history = [];
      return null;
    }
    const pts = face.points;
    const height = Math.hypot(pts[FOREHEAD].x - pts[CHIN].x, pts[FOREHEAD].y - pts[CHIN].y) || 1;
    const width = Math.hypot(pts[LEFT_CHEEK].x - pts[RIGHT_CHEEK].x, pts[LEFT_CHEEK].y - pts[RIGHT_CHEEK].y) || 1;
    // Nose position relative to the face centre: moving the whole body doesn't count.
    const cx = (pts[LEFT_CHEEK].x + pts[RIGHT_CHEEK].x) / 2;
    const cy = (pts[FOREHEAD].y + pts[CHIN].y) / 2;
    const x = (pts[NOSE].x - cx) / width;
    const y = (pts[NOSE].y - cy) / height;

    const coolingDown = t - this.tLast < this.options.cooldownMs;

    this.history.push({ t, x, y });
    while (this.history.length && t - this.history[0].t > this.options.windowMs) this.history.shift();
    if (coolingDown || this.history.length < 6) return null;

    const xs = this.history.map((h) => h.x);
    const ys = this.history.map((h) => h.y);
    const rx = Math.max(...xs) - Math.min(...xs);
    const ry = Math.max(...ys) - Math.min(...ys);
    // Back and forth: the current value has returned near the start after moving away.
    const returned = (values: number[], range: number) =>
      Math.abs(values[values.length - 1] - values[0]) < 0.4 * range;
    const { amplitude, dominance } = this.options;
    if (ry > amplitude && ry > dominance * rx && returned(ys, ry)) return this.emit(t, "nod");
    if (rx > amplitude && rx > dominance * ry && returned(xs, rx)) return this.emit(t, "shake");
    return null;
  }

  private emit(t: number, g: HeadGesture): HeadGesture {
    this.tLast = t;
    this.history = [];
    return g;
  }
}
