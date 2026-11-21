// Synthetic hand generator (image coordinates) for the tests.
import type { Hand, Point3D } from "../types.ts";

export interface HandShape {
  thumb?: "out" | "up" | "down" | "folded";
  index?: boolean;
  middle?: boolean;
  ring?: boolean;
  pinky?: boolean;
  pinch?: boolean;
  /** Offset of the whole hand in the image. */
  dx?: number;
  dy?: number;
}

const p = (x: number, y: number, z = 0): Point3D => ({ x, y, z });

/** Upright hand (wrist at the bottom) seen from the front. */
export function makeHand(s: HandShape = {}): Hand {
  const pts: Point3D[] = new Array(21);
  pts[0] = p(0.5, 0.8);
  // Thumb
  pts[1] = p(0.42, 0.75);
  if (s.thumb === "up") {
    pts[2] = p(0.4, 0.68);
    pts[3] = p(0.4, 0.57);
    pts[4] = p(0.4, 0.46);
  } else if (s.thumb === "down") {
    pts[2] = p(0.4, 0.72);
    pts[3] = p(0.4, 0.83);
    pts[4] = p(0.4, 0.94);
  } else if (s.thumb === "out") {
    pts[2] = p(0.38, 0.7);
    pts[3] = p(0.33, 0.65);
    pts[4] = p(0.28, 0.6);
  } else {
    pts[2] = p(0.4, 0.7);
    pts[3] = p(0.44, 0.66);
    pts[4] = p(0.47, 0.63);
  }
  const fingers: [number, boolean][] = [
    [0.44, !!s.index],
    [0.48, !!s.middle],
    [0.52, !!s.ring],
    [0.56, !!s.pinky],
  ];
  fingers.forEach(([x, extended], i) => {
    const b = 5 + i * 4;
    pts[b] = p(x, 0.6);
    if (extended) {
      pts[b + 1] = p(x, 0.55);
      pts[b + 2] = p(x, 0.51);
      pts[b + 3] = p(x, 0.48);
    } else {
      pts[b + 1] = p(x, 0.55);
      pts[b + 2] = p(x, 0.58);
      pts[b + 3] = p(x, 0.63);
    }
  });
  if (s.pinch) {
    pts[6] = p(0.44, 0.55);
    pts[7] = p(0.42, 0.52);
    pts[8] = p(0.4, 0.54);
    pts[4] = p(0.4, 0.555);
  }
  const dx = s.dx ?? 0;
  const dy = s.dy ?? 0;
  return { points: pts.map((q) => p(q.x + dx, q.y + dy, q.z)), score: 0.9 };
}

/** One shape per gesture; the key is the gesture the classifier must return. */
export const SHAPES = {
  palm: { thumb: "out", index: true, middle: true, ring: true, pinky: true },
  point: { index: true },
  victory: { index: true, middle: true },
  fist: {},
  thumbs_up: { thumb: "up" },
  thumbs_down: { thumb: "down" },
  pinch: { pinch: true, middle: true, ring: true, pinky: true },
} satisfies Record<string, HandShape>;

/** Rotates the whole hand around the wrist (degrees; positive = clockwise in the image). */
export function rotate(h: Hand, degrees: number): Hand {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const o = h.points[0];
  return {
    ...h,
    points: h.points.map((q) => ({
      x: o.x + (q.x - o.x) * c - (q.y - o.y) * s,
      y: o.y + (q.x - o.x) * s + (q.y - o.y) * c,
      z: q.z,
    })),
  };
}

/** Scales the whole hand around the wrist: larger looks nearer the camera. */
export function scale(h: Hand, k: number, dx = 0): Hand {
  const o = h.points[0];
  return {
    ...h,
    points: h.points.map((q) => ({ x: o.x + (q.x - o.x) * k + dx, y: o.y + (q.y - o.y) * k, z: q.z })),
  };
}
