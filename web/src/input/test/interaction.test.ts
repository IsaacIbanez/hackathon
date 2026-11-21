import { test } from "node:test";
import assert from "node:assert/strict";
import { HandInteraction } from "../interaction.ts";
import { actionFor } from "../actions.ts";
import type { Hand, HandEvent } from "../types.ts";
import { makeHand, SHAPES } from "./hand.ts";

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

test("dwellProgress fills up while pointing still and resets after the selection", () => {
  const ctl = new HandInteraction();
  const hand = makeHand(SHAPES.point);
  const progress: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t = i * STEP;
    ctl.process({ t, hands: [hand] });
    progress.push(ctl.dwellProgress(t));
  }
  const peak = Math.max(...progress);
  assert.ok(peak > 0.9, `peak ${peak}`);
  assert.ok(progress[10] > 0 && progress[10] < progress[20], "it grows while holding still");
  assert.equal(progress.at(-1), 0, "after selecting it goes back to 0");
  assert.equal(ctl.dwellProgress(40 * STEP + 1000), 0, "and stays 0 when no longer pointing");
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
