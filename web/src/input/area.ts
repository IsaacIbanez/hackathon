// Which part of the camera image the fingertip moves in to point at the screen.
import type { Point } from "./types.ts";

/**
 * Part of the camera image the index fingertip moves in to cover the whole screen (image
 * coordinates, unmirrored). Smaller than the image, so little hand movement is needed, and high
 * up: the hand is below the fingertip, so with the tip near the bottom of the image the hand would
 * leave the camera's view.
 */
export const POINTER_AREA: Area = { left: 0.27, right: 0.73, top: 0.06, bottom: 0.5 };

/** A part of the camera image, in image coordinates. */
export interface Area {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The whole image: the menu cells are thirds of it (the reader's menu draws its boxes there). */
export const FULL_IMAGE: Area = { left: 0, right: 1, top: 0, bottom: 1 };

/**
 * The fingertip as a position on the screen, as the user sees it: [0, 1] × [0, 1] over
 * POINTER_AREA (mirrored when the camera faces the user), clamped to the edges.
 */
export function areaPoint(p: Point, mirror = true, area = POINTER_AREA): Point {
  const x = mirror ? 1 - p.x : p.x;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((x - area.left) / (area.right - area.left)),
    y: clamp((p.y - area.top) / (area.bottom - area.top)),
  };
}
