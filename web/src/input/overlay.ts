// Visual feedback for the hand module: draws the camera image, the hand skeleton, the detected
// pose, the quick menu and the volume control on a canvas. Shared by any screen that uses
// HandInteraction, so the user always sees what the app is detecting.

import { menuFor, type Action } from "./actions.ts";
import type { HandInteraction } from "./interaction.ts";
import { CONNECTIONS, type Gesture, type HandFrame, type HandSide, type MenuSector, type Point } from "./types.ts";

export const GESTURE_LABELS: Record<Gesture, string> = {
  none: "No gesture",
  point: "☝️ Pointing",
  palm: "✋ Open palm",
  fist: "✊ Fist (menu)",
  thumbs_up: "👍 Thumbs up",
  thumbs_down: "👎 Thumbs down",
  pinch: "🤏 Pinch",
};

export const ACTION_LABELS: Partial<Record<Action, string>> = {
  read: "Read",
  pause: "Pause",
  next: "Next",
  previous: "Previous",
  explain_here: "Explain this",
  repeat: "Repeat",
  dictate: "Ask by voice",
  ask_for_help: "Help",
  adjust_volume: "Volume",
  volume: "Volume",
  undo: "Undo",
};

const HAND_LABELS: Record<HandSide, string> = { right: "right hand", left: "left hand" };
export const ARROWS: Record<MenuSector, string> = {
  up: "↑", right: "→", down: "↓", left: "←", up_left: "↖", up_right: "↗", down_left: "↙", down_right: "↘",
};

export interface OverlayOptions {
  /** Show the image as a mirror (what the user expects from a front camera). Default true. */
  mirror?: boolean;
  /** Current time in ms (performance.now() by default). */
  t?: number;
  /** Draw the camera image (false: a transparent layer over a <video>). Default true. */
  drawVideo?: boolean;
  /** Draw the pointer dot (false if the screen draws it itself). Default true. */
  drawPointer?: boolean;
}

/**
 * Draws one frame. The canvas is resized to the video; call it from requestAnimationFrame.
 * Hand coordinates come unmirrored from the tracker and are mirrored here, so all text stays readable.
 */
export function drawHandOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: HandFrame | null,
  interaction: HandInteraction,
  options: OverlayOptions = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mirror = options.mirror ?? true;
  const t = options.t ?? performance.now();
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  // Resizing a canvas reallocates it: only do it when the video size changes.
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const X = (p: Point) => (mirror ? 1 - p.x : p.x) * w;
  const Y = (p: Point) => p.y * h;
  const unit = h / 480; // scale text and strokes with the image

  ctx.clearRect(0, 0, w, h);
  if (options.drawVideo !== false && video.readyState >= 2) {
    ctx.save();
    if (mirror) ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  }
  if (!interaction.isAwake) {
    ctx.fillStyle = "#0009";
    ctx.fillRect(0, 0, w, h);
  }

  // Faces: a few dots, enough to see that the face is tracked.
  if (frame?.face) {
    ctx.fillStyle = "#4cc9f088";
    for (let i = 0; i < frame.face.points.length; i += 6) {
      const p = frame.face.points[i];
      ctx.fillRect(X(p) - 1, Y(p) - 1, 2 * unit, 2 * unit);
    }
  }

  // Hands: the one being followed (the nearest, see HandInteraction.activeHand) is bright, others dimmed.
  const hands = frame?.hands ?? [];
  const followed = interaction.activeHand ? hands.indexOf(interaction.activeHand) : -1;
  const best = followed >= 0 ? followed : hands.reduce((b, hd, i) => ((hd.score ?? 0) > (hands[b]?.score ?? -1) ? i : b), 0);
  for (const [k, hand] of hands.entries()) {
    const active = k === best;
    ctx.strokeStyle = active ? "#ffffffcc" : "#ffffff55";
    ctx.lineWidth = 4 * unit;
    ctx.lineCap = "round";
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(X(hand.points[a]), Y(hand.points[a]));
      ctx.lineTo(X(hand.points[b]), Y(hand.points[b]));
      ctx.stroke();
    }
    for (const [i, p] of hand.points.entries()) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.fillStyle = !active ? "#ffffff66" : tip ? "#ffd23f" : "#ffffff";
      ctx.beginPath();
      ctx.arc(X(p), Y(p), (tip ? 7 : 4.5) * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    if (active) {
      const wake = interaction.wakeProgress(t);
      if (wake > 0) ring(ctx, X(hand.points[0]), Y(hand.points[0]), 40 * unit, wake, "#3ddc97", 10 * unit);
    }
  }

  drawVolume(ctx, interaction, t, X, Y, w, h, unit);

  const menu = interaction.menuOpen(t);
  if (menu) drawMenu(ctx, menu, w, h, unit);

  const p = options.drawPointer === false ? null : interaction.pointer;
  if (p) {
    ctx.fillStyle = "#ff5d5d";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.arc(X(p), Y(p), 12 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Status chip: pose and hand in use, always on top.
  const hand = interaction.handInUse;
  const pose = (frame?.hands.length ?? 0) > 0 ? GESTURE_LABELS[interaction.pose] : "No hand in view";
  const chip = interaction.isAwake ? `${pose}${hand ? ` · ${HAND_LABELS[hand]}` : ""}` : "Asleep: hold an open palm to wake";
  label(ctx, chip, 16 * unit, 16 * unit, 26 * unit, "#fff", "left");
}

function drawVolume(
  ctx: CanvasRenderingContext2D,
  interaction: HandInteraction,
  t: number,
  X: (p: Point) => number,
  Y: (p: Point) => number,
  w: number,
  h: number,
  unit: number,
): void {
  const n = interaction.levelActive(t);
  if (!n) {
    if (interaction.levelArmed) label(ctx, "🤏 Touch thumb and index, then open them", w / 2, h * 0.9, 28 * unit, "#4cc9f0");
    return;
  }
  ctx.strokeStyle = `hsl(${Math.round(120 * n.value)}, 90%, 55%)`;
  ctx.lineWidth = 8 * unit;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(X(n.thumb), Y(n.thumb));
  ctx.lineTo(X(n.index), Y(n.index));
  ctx.stroke();
  const mx = (X(n.thumb) + X(n.index)) / 2;
  const my = Math.min(Y(n.thumb), Y(n.index)) - 40 * unit;
  label(ctx, `🔊 ${Math.round(n.value * 100)} %`, mx, my, 40 * unit, "#ffd23f");
  if (n.confirmProgress > 0) ring(ctx, mx, my + 40 * unit, 18 * unit, n.confirmProgress, "#3ddc97", 6 * unit);
}

/** Quick menu as four big boxes around the screen (from the user's point of view). */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  menu: { sector: MenuSector | null; progress: number; hand: HandSide | null },
  w: number,
  h: number,
  unit: number,
): void {
  ctx.fillStyle = "#0b0d12b0";
  ctx.fillRect(0, 0, w, h);
  const options = menuFor(menu.hand);
  const bw = w * 0.3;
  const bh = h * 0.2;
  // This menu only uses the cross; the corners are for menus with more options.
  const boxes: Partial<Record<MenuSector, [number, number]>> = {
    up: [(w - bw) / 2, h * 0.06],
    down: [(w - bw) / 2, h * 0.94 - bh],
    left: [w * 0.04, (h - bh) / 2],
    right: [w * 0.96 - bw, (h - bh) / 2],
  };
  for (const s of Object.keys(boxes) as MenuSector[]) {
    const action = options[s];
    if (!action) continue;
    const [x, y] = boxes[s]!;
    const active = menu.sector === s;
    ctx.fillStyle = active ? "#ffd23f33" : "#1b2030ee";
    ctx.fillRect(x, y, bw, bh);
    if (active) {
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(x, y + bh - 8 * unit, bw * menu.progress, 8 * unit);
    }
    ctx.strokeStyle = active ? "#ffd23f" : "#ffffff55";
    ctx.lineWidth = (active ? 4 : 2) * unit;
    ctx.strokeRect(x, y, bw, bh);
    label(ctx, `${ARROWS[s]} ${ACTION_LABELS[action] ?? action}`, x + bw / 2, y + bh / 2, 30 * unit, active ? "#ffd23f" : "#fff");
  }
  label(ctx, "Move your finger to an option and hold", w / 2, h / 2, 22 * unit, "#cfd6e4");
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, progress: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
}

function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
): void {
  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = align === "left" ? "top" : "middle";
  ctx.lineWidth = size / 5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
