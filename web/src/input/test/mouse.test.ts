import { test } from "node:test";
import assert from "node:assert/strict";
import { HandInteraction } from "../interaction.ts";
import { classifyPose } from "../poses.ts";
import type { Hand, HandEvent } from "../types.ts";
import { CLICK_PRESS, CLICK_REST, makeHand, SHAPES } from "./hand.ts";

const STEP = 33;
const repeat = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
const rest = makeHand(CLICK_REST);
const press = makeHand(CLICK_PRESS);

function simulate(ctl: HandInteraction, frames: (Hand | null)[]): HandEvent[] {
  const events: HandEvent[] = [];
  const off = ctl.on((e) => events.push(e));
  frames.forEach((h, i) => ctl.process({ t: i * STEP, hands: h ? [h] : [] }));
  off();
  return events;
}

const mouse = (ev: HandEvent[]) => ev.flatMap((e) => (e.type === "mouse" ? [e.action] : []));
const withMouse = () => new HandInteraction({ mouseClicks: true });

test("click gesture: resting is pointing; pressing reads as a pinch, which still points with the mouse on", () => {
  assert.equal(classifyPose(rest), "point");
  assert.equal(classifyPose(press), "pinch"); // the thumb also gets near the index
});

test("click: a short tap of the middle finger on the thumb", () => {
  const ev = simulate(withMouse(), [...repeat(rest, 10), ...repeat(press, 3), ...repeat(rest, 20)]);
  assert.deepEqual(mouse(ev), ["click"]);
});

test("click: two quick taps are a right click (not two clicks)", () => {
  const ev = simulate(withMouse(), [
    ...repeat(rest, 10),
    ...repeat(press, 3),
    ...repeat(rest, 4),
    ...repeat(press, 3),
    ...repeat(rest, 20),
  ]);
  assert.deepEqual(mouse(ev), ["right_click"]);
});

test("click: two taps far apart are two clicks", () => {
  const ev = simulate(withMouse(), [
    ...repeat(rest, 10),
    ...repeat(press, 3),
    ...repeat(rest, 20),
    ...repeat(press, 3),
    ...repeat(rest, 20),
  ]);
  assert.deepEqual(mouse(ev), ["click", "click"]);
});

test("click: holding the fingers together holds the button (drag) until they separate", () => {
  const ev = simulate(withMouse(), [...repeat(rest, 10), ...repeat(press, 20), ...repeat(rest, 10)]);
  assert.deepEqual(mouse(ev), ["down", "up"]);
});

test("click: losing the hand while dragging releases the button", () => {
  const ev = simulate(withMouse(), [...repeat(rest, 10), ...repeat(press, 20), ...repeat(null, 15)]);
  assert.deepEqual(mouse(ev), ["down", "up"]);
});

test("click: pointing with the middle finger curled next to the thumb never clicks", () => {
  // In the plain pointing hand the curled middle fingertip sits right by the thumb tip.
  const ev = simulate(withMouse(), [...repeat(makeHand(SHAPES.point), 40), ...repeat(rest, 5)]);
  assert.deepEqual(mouse(ev), []);
});

test("click: off by default", () => {
  const ev = simulate(new HandInteraction(), [...repeat(rest, 10), ...repeat(press, 3), ...repeat(rest, 20)]);
  assert.deepEqual(mouse(ev), []);
});

test("click: the cursor stays put while tapping, so the click lands where the user pointed", () => {
  const ctl = withMouse();
  const frames = [...repeat(rest, 10), ...repeat(press, 3), ...repeat(rest, 20)];
  const events: { i: number; e: HandEvent }[] = [];
  ctl.on((e) => events.push({ i: Math.round(e.t / STEP), e }));
  frames.forEach((h, i) => ctl.process({ t: i * STEP, hands: [h] }));
  const click = events.find(({ e }) => e.type === "mouse")!;
  const moved = events.filter(({ i, e }) => e.type === "pointer" && i > 10 && i <= click.i);
  assert.deepEqual(moved, []);
  assert.ok(events.some(({ i, e }) => e.type === "pointer" && i < 10), "it moves while resting");
});

test("click: with the mouse on, holding the pointer still doesn't 'select' (no dwell click)", () => {
  const ev = simulate(withMouse(), repeat(rest, 60));
  assert.ok(!ev.some((e) => e.type === "select"));
  assert.ok(simulate(new HandInteraction(), repeat(rest, 60)).some((e) => e.type === "select"));
});

test("scroll: with the mouse on, the open palm moving up or down turns the wheel", () => {
  const palmAt = (dy: number) => makeHand({ ...SHAPES.palm, dy });
  const up = Array.from({ length: 12 }, (_, i) => palmAt(-0.01 * i)); // the hand rises ~0.11
  const scrolls = simulate(withMouse(), up).flatMap((e) => (e.type === "scroll" ? [e.direction] : []));
  assert.deepEqual(scrolls, ["up", "up"]);
  assert.ok(!simulate(new HandInteraction(), up).some((e) => e.type === "scroll"), "only in cursor mode");
});
