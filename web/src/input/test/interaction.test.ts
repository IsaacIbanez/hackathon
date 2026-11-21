import { test } from "node:test";
import assert from "node:assert/strict";
import { HandInteraction } from "../interaction.ts";
import { actionFor } from "../actions.ts";
import type { Hand, HandEvent } from "../types.ts";
import { makeHand, scale, SHAPES } from "./hand.ts";

const STEP = 33; // ~30 fps

function simulate(ctl: HandInteraction, frames: (Hand | null)[], t0 = 0): HandEvent[] {
  const events: HandEvent[] = [];
  const off = ctl.on((e) => events.push(e));
  frames.forEach((h, i) => ctl.process({ t: t0 + i * STEP, hands: h ? [h] : [] }));
  off();
  return events;
}

const repeat = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

test("a held gesture is emitted only once", () => {
  const ctl = new HandInteraction();
  const ev = simulate(ctl, repeat(makeHand(SHAPES.thumbs_up), 30));
  const gestures = ev.filter((e) => e.type === "gesture");
  assert.deepEqual(
    gestures.map((e) => e.type === "gesture" && e.gesture),
    ["thumbs_up"],
  );
  assert.equal(actionFor(gestures[0]), "read");
});

test("a gesture that is too brief is not emitted", () => {
  const ctl = new HandInteraction();
  const frames = [
    ...repeat(makeHand(SHAPES.fist), 15),
    ...repeat(makeHand(SHAPES.palm), 5),
    ...repeat(makeHand(SHAPES.fist), 5),
  ];
  const ev = simulate(ctl, frames);
  assert.ok(!ev.some((e) => e.type === "gesture" && e.gesture === "palm"));
});

test("swiping the open hand to the user's right is 'next' and doesn't trigger 'pause'", () => {
  const ctl = new HandInteraction(); // mirror: true (camera facing the user)
  // In the unmirrored image, moving the hand to the user's right means decreasing x.
  const frames = Array.from({ length: 10 }, (_, i) => makeHand({ ...SHAPES.palm, dx: -0.04 * i }));
  const ev = simulate(ctl, frames);
  const swipes = ev.filter((e) => e.type === "swipe");
  assert.equal(swipes.length, 1);
  assert.equal(actionFor(swipes[0]), "next");
  assert.ok(!ev.some((e) => e.type === "gesture" && e.gesture === "palm"));
});

test("swiping to the left is 'previous'", () => {
  const ctl = new HandInteraction();
  const frames = Array.from({ length: 10 }, (_, i) => makeHand({ ...SHAPES.palm, dx: 0.04 * i }));
  const swipes = simulate(ctl, frames).filter((e) => e.type === "swipe");
  assert.equal(swipes.length, 1);
  assert.equal(actionFor(swipes[0]), "previous");
});

test("pointing emits a rate-limited pointer and a dwell selection", () => {
  const ctl = new HandInteraction();
  const ev = simulate(ctl, repeat(makeHand(SHAPES.point), 40)); // ~1.3 s
  const pointers = ev.filter((e) => e.type === "pointer");
  assert.ok(pointers.length >= 15 && pointers.length <= 22, `pointers: ${pointers.length}`);
  const sel = ev.filter((e) => e.type === "select");
  assert.equal(sel.length, 1);
  assert.equal(actionFor(sel[0]), "explain_here");
  // The pointer leads slightly past the index tip (y = 0.48).
  const p = pointers[pointers.length - 1];
  assert.ok(p.type === "pointer" && p.image.y < 0.48);
});

test("the pointer is mapped to document coordinates", () => {
  const ctl = new HandInteraction({ pointerLead: 0 });
  // Document spanning x 0.34–0.54 and y 0.38–0.58: the tip (0.44, 0.48) falls in its centre.
  ctl.setDocument([
    { x: 0.34, y: 0.38 },
    { x: 0.54, y: 0.38 },
    { x: 0.54, y: 0.58 },
    { x: 0.34, y: 0.58 },
  ]);
  const ev = simulate(ctl, repeat(makeHand(SHAPES.point), 10));
  const p = ev.filter((e) => e.type === "pointer").pop();
  assert.ok(p && p.type === "pointer" && p.document);
  assert.ok(Math.abs(p.document.x - 0.5) < 1e-6 && Math.abs(p.document.y - 0.5) < 1e-6);
});

test("losing the hand emits 'hand absent' and resets the gesture", () => {
  const ctl = new HandInteraction({ useFist: true });
  const ev = simulate(ctl, [...repeat(makeHand(SHAPES.fist), 15), ...repeat(null, 15)]);
  const kinds = ev.map((e) =>
    e.type === "gesture" ? `gesture:${e.gesture}` : e.type === "hand" ? `hand:${e.present}` : e.type,
  );
  assert.deepEqual(kinds, ["hand:true", "gesture:fist", "gesture:none", "hand:false"]);
});

// ---- Several hands ----

function simulateMany(ctl: HandInteraction, frames: Hand[][], t0 = 0): HandEvent[] {
  const events: HandEvent[] = [];
  const off = ctl.on((e) => events.push(e));
  frames.forEach((hands, i) => ctl.process({ t: t0 + i * STEP, hands }));
  off();
  return events;
}

test("with two hands in view, the one nearest the camera (largest) is followed", () => {
  const near = scale(makeHand(SHAPES.thumbs_up), 1.5, -0.25);
  const far = scale(makeHand(SHAPES.palm), 0.7, 0.25);
  const ctl = new HandInteraction();
  const ev = simulateMany(ctl, repeat([far, near], 20));
  const gestures = ev.filter((e) => e.type === "gesture").map((e) => e.type === "gesture" && e.gesture);
  assert.deepEqual(gestures, ["thumbs_up"]);
  assert.equal(ctl.activeHand?.points[0].x, near.points[0].x);
});

test("a slightly larger second hand doesn't steal the focus; a clearly nearer one does", () => {
  const ctl = new HandInteraction();
  const mine = scale(makeHand(SHAPES.thumbs_up), 1.0, -0.25);
  simulateMany(ctl, repeat([mine], 15));
  assert.equal(ctl.activeHand?.points[0].x, mine.points[0].x);

  const similar = scale(makeHand(SHAPES.palm), 1.1, 0.25); // only 10 % larger: keep following mine
  const ev1 = simulateMany(ctl, repeat([mine, similar], 15), 15 * STEP);
  assert.equal(ctl.activeHand?.points[0].x, mine.points[0].x);
  assert.ok(!ev1.some((e) => e.type === "gesture" && e.gesture === "palm"));

  const muchNearer = scale(makeHand(SHAPES.palm), 1.6, 0.25); // 60 % larger: it takes over
  const ev2 = simulateMany(ctl, repeat([mine, muchNearer], 20), 30 * STEP);
  assert.equal(ctl.activeHand?.points[0].x, muchNearer.points[0].x);
  assert.ok(ev2.some((e) => e.type === "gesture" && e.gesture === "palm"));
});
