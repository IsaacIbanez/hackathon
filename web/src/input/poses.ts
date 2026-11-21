// Static hand pose classification from its 21 landmarks.
// It uses each finger's "straightness" (straight length / length along the phalanges),
// which does not depend on rotation or on the distance to the camera.

import { distance } from "./geometry.ts";
import { L, type Gesture, type Hand, type Point3D } from "./types.ts";

export interface FingerState {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface Thresholds {
  /** Straightness above which a finger counts as extended. */
  extended: number;
  /** Straightness above which the thumb counts as extended. */
  thumbExtended: number;
  /** Thumb–index distance (relative to hand size) for the pinch pose. */
  pinch: number;
  /**
   * Minimum index reach (wrist→tip / wrist→knuckle) for the pinch. In a fist the index tip sits
   * at knuckle height (~0.8–1); in a pinch it is further out (≥1.2).
   */
  indexOut: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  extended: 0.9,
  thumbExtended: 0.88,
  pinch: 0.5,
  indexOut: 1.0,
};

const CHAINS = {
  index: [L.INDEX_MCP, L.INDEX_PIP, L.INDEX_DIP, L.INDEX_TIP],
  middle: [L.MIDDLE_MCP, L.MIDDLE_PIP, L.MIDDLE_DIP, L.MIDDLE_TIP],
  ring: [L.RING_MCP, L.RING_PIP, L.RING_DIP, L.RING_TIP],
  pinky: [L.PINKY_MCP, L.PINKY_PIP, L.PINKY_DIP, L.PINKY_TIP],
} as const;

const THUMB_CHAIN = [L.THUMB_MCP, L.THUMB_IP, L.THUMB_TIP] as const;

/** 1 = perfectly straight finger; low values = bent finger. */
export function straightness(pts: Point3D[], chain: readonly number[]): number {
  let alongPhalanges = 0;
  for (let i = 1; i < chain.length; i++) {
    alongPhalanges += distance(pts[chain[i - 1]], pts[chain[i]]);
  }
  if (alongPhalanges === 0) return 0;
  return distance(pts[chain[0]], pts[chain[chain.length - 1]]) / alongPhalanges;
}

/** Points used to measure the shape: world points if present; otherwise image points corrected by aspect. */
export function shapePoints(hand: Hand, aspect = 1): Point3D[] {
  if (hand.worldPoints && hand.worldPoints.length === 21) return hand.worldPoints;
  return hand.points.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));
}

export function fingerState(pts: Point3D[], th: Thresholds = DEFAULT_THRESHOLDS): FingerState {
  const size = handSize(pts);
  const extended = (chain: readonly number[]) =>
    straightness(pts, chain) >= th.extended &&
    // The tip must be far from the wrist: rules out straight fingers folded over the palm.
    distance(pts[L.WRIST], pts[chain[chain.length - 1]]) > 1.3 * distance(pts[L.WRIST], pts[chain[0]]);
  // The thumb counts as extended if it is straight and its tip is away from the palm.
  const thumb =
    straightness(pts, THUMB_CHAIN) >= th.thumbExtended &&
    distance(pts[L.THUMB_TIP], pts[L.INDEX_MCP]) > 0.5 * size;
  return {
    thumb,
    index: extended(CHAINS.index),
    middle: extended(CHAINS.middle),
    ring: extended(CHAINS.ring),
    pinky: extended(CHAINS.pinky),
  };
}

/** Reference size: wrist → middle-finger knuckle. */
export function handSize(pts: Point3D[]): number {
  return distance(pts[L.WRIST], pts[L.MIDDLE_MCP]) || 1;
}

/** Distance between the thumb and index fingertips, relative to hand size. */
export function pinchSeparation(pts: Point3D[]): number {
  return distance(pts[L.THUMB_TIP], pts[L.INDEX_TIP]) / handSize(pts);
}

/** Wrist→index tip divided by wrist→index knuckle: <1 when the index is tucked into a fist. */
export function indexReach(pts: Point3D[]): number {
  return distance(pts[L.WRIST], pts[L.INDEX_TIP]) / (distance(pts[L.WRIST], pts[L.INDEX_MCP]) || 1);
}

/** Hand pose. Image points are used to know which way is "up". */
export function classifyPose(hand: Hand, aspect = 1, th: Thresholds = DEFAULT_THRESHOLDS): Gesture {
  const pts = shapePoints(hand, aspect);
  if (pts.length !== 21) return "none";
  const f = fingerState(pts, th);
  const otherThree = [f.middle, f.ring, f.pinky];
  const nOthers = otherThree.filter(Boolean).length;

  // Pinch: thumb and index fingertips together, with the index out in front (not tucked into a
  // fist). The other three fingers don't matter.
  if (pinchSeparation(pts) < th.pinch && indexReach(pts) >= th.indexOut) return "pinch";
  if (f.index && f.middle && f.ring && f.pinky) return "palm";
  if (f.index && f.middle && !f.ring && !f.pinky) return "victory";
  if (f.index && nOthers === 0) return "point";
  if (!f.index && nOthers === 0) {
    if (f.thumb) {
      const d = thumbDirection(hand, aspect);
      if (d === "up") return "thumbs_up";
      if (d === "down") return "thumbs_down";
    }
    return "fist";
  }
  return "none";
}

/** Where the thumb points in the image: clearly up, clearly down, or neither. */
export function thumbDirection(hand: Hand, aspect = 1): "up" | "down" | null {
  const base = hand.points[L.THUMB_MCP];
  const tip = hand.points[L.THUMB_TIP];
  const dx = (tip.x - base.x) * aspect;
  const dy = tip.y - base.y;
  if (Math.abs(dy) <= 1.2 * Math.abs(dx)) return null;
  return dy < 0 ? "up" : "down";
}
