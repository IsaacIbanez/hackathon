import { test } from "node:test";
import assert from "node:assert/strict";
import { HandInteraction } from "../interaction.ts";
import { actionFor } from "../actions.ts";
import { HeadGestureDetector } from "../head.ts";
import type { Face, Hand, HandEvent, HandFrame } from "../types.ts";
import { makeHand, rotate, SHAPES, WAKE_PALM } from "./hand.ts";

const STEP = 33;
const repeat = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

function simulate(ctl: HandInteraction, frames: (Hand | null)[], t0 = 0): HandEvent[] {
  const events: HandEvent[] = [];
  const off = ctl.on((e) => events.push(e));
  frames.forEach((h, i) => ctl.process({ t: t0 + i * STEP, hands: h ? [h] : [] }));
  off();
  return events;
}

test("wake mode: gestures are ignored until a strict open palm is held ~1 s", () => {
  const ctl = new HandInteraction({ requireWake: true });
  const ev = simulate(ctl, [
    ...repeat(makeHand(SHAPES.thumbs_up), 20), // asleep: ignored
    ...repeat(makeHand(WAKE_PALM), 45), // wakes (without triggering "pause")
    ...repeat(makeHand(SHAPES.thumbs_up), 20), // now it counts
  ]);
  const actions = ev.map((e) => actionFor(e)).filter(Boolean);
  assert.deepEqual(actions, ["wake", "read"]);
});

test("wake mode: a relaxed, turned or tilted open hand doesn't wake (and says why)", () => {
  const cases: [string, Hand, string][] = [
    ["fingers together", makeHand({ ...WAKE_PALM, spread: 0 }), "spread"],
    ["back of the hand", makeHand({ ...WAKE_PALM, handedness: "Right" }), "facing"],
    ["no handedness: can't tell the palm from the back", makeHand({ ...WAKE_PALM, handedness: undefined }), "facing"],
    ["tilted 60°", { ...rotate(makeHand(WAKE_PALM), 60), handedness: "Left" }, "upright"],
  ];
  for (const [name, hand, hint] of cases) {
    const ctl = new HandInteraction({ requireWake: true });
    const ev = simulate(ctl, repeat(hand, 60));
    assert.ok(!ev.some((e) => e.type === "mode"), `${name}: must not wake`);
    assert.equal(ctl.wakeHint, hint, name);
  }
});

test("wake mode: goes back to sleep after a while without activity", () => {
  const ctl = new HandInteraction({ requireWake: true, sleepMs: 500 });
  const ev = simulate(ctl, [...repeat(makeHand(WAKE_PALM), 45), ...repeat(null, 30)]);
  assert.deepEqual(
    ev.filter((e) => e.type === "mode").map((e) => e.type === "mode" && e.awake),
    [true, false],
  );
});

test("thumbs down is 'undo' in a document and 'clear_field' in a form", () => {
  const ev = simulate(new HandInteraction(), repeat(makeHand(SHAPES.thumbs_down), 20));
  const g = ev.find((e) => e.type === "gesture")!;
  assert.equal(actionFor(g, "document"), "undo");
  assert.equal(actionFor(g, "form"), "clear_field");
});

/** Controller with the volume already armed (as after choosing "adjust volume" in the menu). */
function armed(options: ConstructorParameters<typeof HandInteraction>[0] = {}): HandInteraction {
  const ctl = new HandInteraction(options);
  ctl.startLevel(0);
  return ctl;
}

/** Pinch with the thumb `sep` away from the index (downwards), other three fingers extended. */
function openPinch(sep: number): Hand {
  const h = makeHand(SHAPES.pinch);
  const i = h.points[8];
  h.points[4] = { x: i.x, y: i.y + sep, z: 0 };
  return h;
}

test("pinch: without choosing 'adjust volume' in the menu, the pinch does nothing", () => {
  const ev = simulate(new HandInteraction(), [...repeat(makeHand(SHAPES.pinch), 10), ...repeat(openPinch(0.2), 20)]);
  assert.ok(!ev.some((e) => e.type === "level"));
});

test("pinch: armed but the fingers never touch, it cancels itself", () => {
  const ctl = armed({ levelArmMs: 500 });
  const phases = simulate(ctl, repeat(makeHand(SHAPES.point), 30))
    .filter((e) => e.type === "level")
    .map((e) => e.type === "level" && e.phase);
  assert.deepEqual(phases, ["cancel"]);
  assert.equal(ctl.levelArmed, false);
});

test("pinch: the thumb–index distance controls a level from 0 to 1 (volume)", () => {
  const ctl = armed();
  const frames = [
    ...repeat(makeHand(SHAPES.pinch), 5), // starts with the fingers together
    ...Array.from({ length: 20 }, (_, i) => openPinch(0.01 * (i + 1))), // opens gradually
    ...repeat(openPinch(0.2), 45), // stays wide open and still: confirmed
  ];
  const ev = simulate(ctl, frames).filter((e) => e.type === "level");
  assert.equal(ev[0].type === "level" && ev[0].phase, "start");
  assert.ok(ev[0].type === "level" && ev[0].value < 0.1, "starts near 0");
  const moves = ev.filter((e) => e.type === "level" && e.phase === "move").map((e) => (e.type === "level" ? e.value : 0));
  assert.ok(moves[moves.length - 1] > 0.7, `rises when opening: ${moves[moves.length - 1]}`);
  const end = ev[ev.length - 1];
  assert.ok(end.type === "level" && end.phase === "end" && end.value > 0.7, `confirmed by holding still: ${JSON.stringify(end)}`);
  assert.equal(actionFor(end, "document"), "volume");
});

test("pinch: while the control is active, no other gestures fire", () => {
  const ctl = armed({ levelConfirmMs: 5000 });
  const ev = simulate(ctl, [...repeat(makeHand(SHAPES.pinch), 8), ...repeat(openPinch(0.2), 30)]);
  assert.ok(ev.some((e) => e.type === "level"));
  assert.ok(!ev.some((e) => e.type === "gesture" || e.type === "swipe"));
});

test("pinch: the level moves in 10 % steps and the scale goes from 0 % to 100 %", () => {
  const ctl = armed();
  const frames = [
    ...repeat(makeHand(SHAPES.pinch), 8),
    ...Array.from({ length: 30 }, (_, i) => openPinch(0.25 * ((i + 1) / 30))),
    ...repeat(openPinch(0.25), 5),
  ];
  const values = simulate(ctl, frames)
    .filter((e) => e.type === "level")
    .map((e) => (e.type === "level" ? e.value : -1));
  assert.equal(values[0], 0, "fingers together = 0 %");
  assert.equal(values[values.length - 1], 1, "wide open = 100 %");
  for (const v of values) assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, `step: ${v}`);
});

test("pinch: holding still ~1 s on the same value confirms it", () => {
  const ctl = armed();
  const frames = [
    ...repeat(makeHand(SHAPES.pinch), 8),
    ...Array.from({ length: 10 }, (_, i) => openPinch(0.01 * (i + 1))), // opens a little
    ...repeat(openPinch(0.1), 40), // and holds still
  ];
  const ev = simulate(ctl, frames).filter((e) => e.type === "level");
  const ends = ev.filter((e) => e.type === "level" && e.phase === "end");
  assert.equal(ends.length, 1, "confirmed once and doesn't start again");
  const lastMove = ev.filter((e) => e.type === "level" && e.phase === "move").pop()!;
  assert.ok(ends[0].type === "level" && lastMove.type === "level" && ends[0].value === lastMove.value);
  assert.ok(ends[0].t - lastMove.t >= 1000);
});

test("pinch: bringing the fingers back together always gives 0 % and the scale doesn't drift", () => {
  const ctl = armed({ levelConfirmMs: 10000 });
  const out = Array.from({ length: 15 }, (_, i) => openPinch(0.25 * ((i + 1) / 15)));
  const back = Array.from({ length: 15 }, (_, i) => openPinch(0.25 * (1 - (i + 1) / 15)));
  const frames = [...repeat(makeHand(SHAPES.pinch), 8), ...out, ...back, ...out, ...back, ...repeat(openPinch(0), 10)];
  const moves = simulate(ctl, frames)
    .filter((e) => e.type === "level" && e.phase === "move")
    .map((e) => (e.type === "level" ? e.value : -1));
  assert.equal(moves.filter((v) => v === 1).length, 2, `reaches 100 % both times: ${moves}`);
  assert.equal(moves[moves.length - 1], 0, `returns to 0 %: ${moves}`);
});

test("pinch: guided calibration sets 0 % and 100 % with a small margin", () => {
  const ctl = armed();
  ctl.setLevelScale(0.1, 1.1);
  assert.deepEqual(ctl.levelScale, { zero: 0.2, full: 1.0 });
});

test("pinch: the value is linear with the thumb–index line measure", () => {
  const ctl = armed({ levelConfirmMs: 10000, levelHysteresis: 0 });
  // The synthetic hand's on-screen size is ≈ 0.2: a 0.125 gap gives a measure of ≈ 0.62 → 50 %.
  const ev = simulate(ctl, [...repeat(makeHand(SHAPES.pinch), 8), ...repeat(openPinch(0.125), 15)]);
  const last = ev.filter((e) => e.type === "level").pop()!;
  assert.ok(last.type === "level" && last.value === 0.5, JSON.stringify(last));
});

test("pinch: jitter at the boundary between two steps doesn't make the value jump", () => {
  const ctl = armed({ levelConfirmMs: 10000 });
  // Set the scale by opening wide and coming back to the middle.
  const frames = [
    ...repeat(makeHand(SHAPES.pinch), 8),
    ...repeat(openPinch(0.2), 10),
    ...repeat(openPinch(0.1), 15),
  ];
  const ev1 = simulate(ctl, frames).filter((e) => e.type === "level" && e.phase === "move").length;
  // Small oscillation around the same point.
  const jitter = Array.from({ length: 30 }, (_, i) => openPinch(0.1 + (i % 2 ? 0.003 : -0.003)));
  const ev2 = simulate(ctl, jitter, 25 * 33).filter((e) => e.type === "level" && e.phase === "move");
  assert.ok(ev1 > 0);
  assert.equal(ev2.length, 0, `changes caused by jitter: ${ev2.length}`);
});

test("pinch: also works with the other three fingers folded", () => {
  const othersFolded = (sep: number) => {
    const h = makeHand({ pinch: true });
    h.points[4] = { x: h.points[8].x, y: h.points[8].y + sep, z: 0 };
    return h;
  };
  const ev = simulate(armed(), [...repeat(othersFolded(0.005), 8), ...repeat(othersFolded(0.2), 15)]).filter(
    (e) => e.type === "level",
  );
  assert.ok(ev.length > 0 && ev[ev.length - 1].type === "level");
  const last = ev[ev.length - 1];
  assert.ok(last.type === "level" && last.value > 0.7, JSON.stringify(last));
});

/** Opens the menu with ✊ (held ~0.5 s), then points with ☝️ with the hand shifted (dx, dy) in the image. */
function pointerInMenu(dx: number, dy: number): Hand[] {
  return [...repeat(makeHand(SHAPES.fist), 20), ...repeat(makeHand({ ...SHAPES.point, dx, dy }), 30)];
}

test("menu: ✊ opens it and holding the pointer on the top option ~0.5 s chooses 'adjust_volume'", () => {
  const ev = simulate(new HandInteraction(), pointerInMenu(0, -0.3)).filter((e) => e.type === "menu");
  const phases = ev.map((e) => e.type === "menu" && `${e.phase}:${e.sector}`);
  assert.deepEqual(phases, ["open:null", "highlight:up", "choose:up"]);
  assert.equal(actionFor(ev[2]), "adjust_volume");
});

test("menu: option zones, as seen by the user", () => {
  // In the unmirrored image, the user's right means decreasing x.
  const cases: [number, number, string][] = [
    [0, 0.3, "down"],
    [-0.15, 0, "right"],
    [0.3, 0, "left"],
  ];
  for (const [dx, dy, expected] of cases) {
    const e = simulate(new HandInteraction(), pointerInMenu(dx, dy)).find((e) => e.type === "menu" && e.phase === "choose");
    assert.ok(e && e.type === "menu" && e.sector === expected, `${dx},${dy} → ${e && e.type === "menu" && e.sector}`);
  }
});

test("menu: with the pointer in the centre nothing is chosen", () => {
  const ev = simulate(new HandInteraction(), pointerInMenu(0, 0));
  assert.ok(!ev.some((e) => e.type === "menu" && e.phase === "choose"));
});

test("menu: holding ✊ chooses nothing and the menu closes by itself", () => {
  const ctl = new HandInteraction({ menuTimeoutMs: 800 });
  const ev = simulate(ctl, repeat(makeHand(SHAPES.fist), 50)).filter((e) => e.type === "menu");
  assert.deepEqual(
    ev.map((e) => e.type === "menu" && e.phase),
    ["open", "close"],
  );
});

test("menu: a brief fist doesn't open it", () => {
  const ev = simulate(new HandInteraction(), [...repeat(makeHand(SHAPES.fist), 10), ...repeat(makeHand(SHAPES.thumbs_up), 3)]);
  assert.ok(!ev.some((e) => e.type === "menu"));
});

test("menu: opening the hand and closing the fist again closes it (and doesn't reopen it)", () => {
  const ev = simulate(new HandInteraction(), [
    ...repeat(makeHand(SHAPES.fist), 20), // opens
    ...repeat(makeHand(SHAPES.palm), 10), // the fist that opened it is released
    ...repeat(makeHand(SHAPES.fist), 40), // closes after ~0.5 s and stays closed
  ]).filter((e) => e.type === "menu");
  assert.deepEqual(
    ev.map((e) => e.type === "menu" && e.phase),
    ["open", "close"],
  );
});

test("menu: corners can be offered with setMenuCells (they aren't by default)", () => {
  const toCorner = pointerInMenu(-0.15, 0.3); // the user's bottom right
  assert.ok(!simulate(new HandInteraction(), toCorner).some((e) => e.type === "menu" && e.phase === "choose"));
  const ctl = new HandInteraction();
  ctl.setMenuCells(["up", "down_right"]);
  assert.deepEqual(ctl.menuSectors(), ["up", "down_right"]);
  const choose = simulate(ctl, toCorner).find((e) => e.type === "menu" && e.phase === "choose");
  assert.ok(choose && choose.type === "menu" && choose.sector === "down_right");
});

test("menu: a submenu opened on 'choose' ignores the chosen cell until the pointer leaves it", () => {
  const ctl = new HandInteraction();
  const chosen: string[] = [];
  ctl.on((e) => {
    if (e.type !== "menu" || e.phase !== "choose") return;
    chosen.push(e.sector!);
    if (chosen.length === 1) {
      ctl.setMenuCells(["up", "down"]); // the submenu also has an option where the pointer is
      ctl.reopenMenu(e.t);
    }
  });
  // Staying on "up": the submenu doesn't choose its own "up" by itself.
  simulate(ctl, [...pointerInMenu(0, -0.3), ...repeat(makeHand({ ...SHAPES.point, dy: -0.3 }), 40)]);
  assert.deepEqual(chosen, ["up"]);

  // Leaving it and coming back does choose it.
  const ctl2 = new HandInteraction();
  const chosen2: string[] = [];
  ctl2.on((e) => {
    if (e.type !== "menu" || e.phase !== "choose") return;
    chosen2.push(e.sector!);
    if (chosen2.length === 1) {
      ctl2.setMenuCells(["up", "down"]);
      ctl2.reopenMenu(e.t);
    }
  });
  simulate(ctl2, [
    ...pointerInMenu(0, -0.3),
    ...repeat(makeHand({ ...SHAPES.point, dy: 0 }), 10), // the centre
    ...repeat(makeHand({ ...SHAPES.point, dy: -0.3 }), 30),
  ]);
  assert.deepEqual(chosen2, ["up", "up"]);
});

test("level: brightness is a target like volume", () => {
  const ctl = new HandInteraction();
  ctl.startLevel(0, "brightness");
  assert.equal(ctl.levelTargetName, "brightness");
  const ev = simulate(ctl, [...repeat(openPinch(0.02), 15), ...repeat(openPinch(0.15), 40)]).filter((e) => e.type === "level");
  assert.ok(ev.length > 1 && ev.every((e) => e.type === "level" && e.target === "brightness"));
  const move = ev.find((e) => e.type === "level" && (e.phase === "move" || e.phase === "end"))!;
  assert.equal(actionFor(move, "pc"), "brightness");
  assert.equal(actionFor({ ...move, target: "volume" } as HandEvent, "pc"), "volume");
});

// ---- Video call context ----

test("call: thumbs up mutes, thumbs down toggles the camera; the palm only wakes", () => {
  const palm = simulate(new HandInteraction(), repeat(makeHand(SHAPES.palm), 20)).find((e) => e.type === "gesture")!;
  assert.equal(actionFor(palm, "call"), null);
  assert.equal(actionFor(palm, "pc"), null);
  assert.equal(actionFor(palm, "document"), "pause"); // the reader still uses it
  const up = simulate(new HandInteraction(), repeat(makeHand(SHAPES.thumbs_up), 20)).find((e) => e.type === "gesture")!;
  assert.equal(actionFor(up, "call"), "toggle_mic");
  const down = simulate(new HandInteraction(), repeat(makeHand(SHAPES.thumbs_down), 20)).find((e) => e.type === "gesture")!;
  assert.equal(actionFor(down, "call"), "toggle_camera");
});

test("call: swipes do nothing and leaving the call is in the quick menu (↓)", () => {
  const swipe = simulate(
    new HandInteraction(),
    Array.from({ length: 10 }, (_, i) => makeHand({ ...SHAPES.palm, dx: -0.04 * i })),
  ).find((e) => e.type === "swipe")!;
  assert.equal(actionFor(swipe, "call"), null);
  const choose = simulate(new HandInteraction(), pointerInMenu(0, 0.3)).find((e) => e.type === "menu" && e.phase === "choose")!;
  assert.equal(actionFor(choose, "call"), "leave_call");
  assert.equal(actionFor(choose, "document"), "repeat");
});

// ---- Hand in use ----

/** Adds MediaPipe's raw handedness label (by default it matches the real hand). */
const withLabel = (h: Hand, label: "Left" | "Right"): Hand => ({ ...h, handedness: label, score: 0.95 });

test("hand in use: MediaPipe's label is used and stabilised", () => {
  const ctl = new HandInteraction();
  simulate(ctl, repeat(withLabel(makeHand(SHAPES.palm), "Right"), 20));
  assert.equal(ctl.handInUse, "right");
  // A couple of mislabelled frames don't change it.
  simulate(ctl, repeat(withLabel(makeHand(SHAPES.palm), "Left"), 2), 20 * 33);
  assert.equal(ctl.handInUse, "right");
  ctl.configure({ invertHandedness: true });
  assert.equal(ctl.handInUse, "left");
});

test("menu with the right hand: no option on the right and 'ask for help' on the left", () => {
  const right = (h: Hand) => withLabel(h, "Right");
  const ctl = new HandInteraction();
  assert.deepEqual(ctl.menuSectors("right"), ["up", "down", "left"]);

  const open = repeat(right(makeHand(SHAPES.fist)), 20);
  const toTheRight = [...open, ...repeat(right(makeHand({ ...SHAPES.point, dx: -0.15 })), 30)];
  assert.ok(!simulate(ctl, toTheRight).some((e) => e.type === "menu" && e.phase === "choose"), "right chooses nothing");

  const toTheLeft = [...open, ...repeat(right(makeHand({ ...SHAPES.point, dx: 0.3 })), 30)];
  const choose = simulate(new HandInteraction(), toTheLeft).find((e) => e.type === "menu" && e.phase === "choose")!;
  assert.ok(choose.type === "menu" && choose.sector === "left" && choose.hand === "right");
  assert.equal(actionFor(choose), "ask_for_help");
});

test("menu with the left hand: 'ask for help' is on the right", () => {
  const left = (h: Hand) => withLabel(h, "Left");
  const frames = [
    ...repeat(left(makeHand(SHAPES.fist)), 20),
    ...repeat(left(makeHand({ ...SHAPES.point, dx: -0.15 })), 30),
  ];
  const choose = simulate(new HandInteraction(), frames).find((e) => e.type === "menu" && e.phase === "choose")!;
  assert.ok(choose.type === "menu" && choose.sector === "right");
  assert.equal(actionFor(choose), "ask_for_help");
});

// ---- Palm facing the camera and fist ----

test("palm: with the back of the hand towards the camera it doesn't count", () => {
  // The synthetic hand has the index on the image's left and the pinky on its right:
  // for a left hand that is the palm; for a right hand, the back of the hand.
  const leftPalm = simulate(new HandInteraction(), repeat(withLabel(makeHand(SHAPES.palm), "Left"), 20));
  assert.ok(leftPalm.some((e) => e.type === "gesture" && e.gesture === "palm"), "left: palm");
  const rightBack = simulate(new HandInteraction(), repeat(withLabel(makeHand(SHAPES.palm), "Right"), 20));
  assert.ok(!rightBack.some((e) => e.type === "gesture" && e.gesture === "palm"), "right: back of the hand");
});

test("fist: held, it is emitted and opens the menu, with no action of its own", () => {
  const ev = simulate(new HandInteraction(), repeat(makeHand(SHAPES.fist), 20));
  const fist = ev.find((e) => e.type === "gesture" && e.gesture === "fist");
  assert.ok(fist);
  assert.equal(actionFor(fist, "pc"), null);
  assert.ok(ev.some((e) => e.type === "menu" && e.phase === "open"));
});

// ---- Head ----

/** Synthetic face: only the points the detector uses are filled in. */
function face(noseX: number, noseY: number): Face {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[10] = { x: 0.5, y: 0.3, z: 0 }; // forehead
  points[152] = { x: 0.5, y: 0.7, z: 0 }; // chin
  points[234] = { x: 0.35, y: 0.5, z: 0 }; // cheek
  points[454] = { x: 0.65, y: 0.5, z: 0 };
  points[1] = { x: noseX, y: noseY, z: 0 };
  return { points };
}

function oscillate(det: HeadGestureDetector, axis: "x" | "y") {
  const r: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = 0.04 * Math.sin((i / 30) * 2 * Math.PI * 1.0);
    const g = det.process(i * STEP, axis === "y" ? face(0.5, 0.5 + d) : face(0.5 + d, 0.5));
    if (g) r.push(g);
  }
  return r;
}

test("head: nod (up-down) and shake (side to side)", () => {
  assert.deepEqual(oscillate(new HeadGestureDetector(), "y"), ["nod"]);
  assert.deepEqual(oscillate(new HeadGestureDetector(), "x"), ["shake"]);
});

test("head: the event goes through the controller and maps according to the context", () => {
  const ctl = new HandInteraction();
  const ev: HandEvent[] = [];
  ctl.on((e) => ev.push(e));
  for (let i = 0; i < 30; i++) {
    const d = 0.04 * Math.sin((i / 30) * 2 * Math.PI);
    const f: HandFrame = { t: i * STEP, hands: [], face: face(0.5, 0.5 + d) };
    ctl.process(f);
  }
  const h = ev.find((e) => e.type === "head")!;
  assert.equal(actionFor(h, "pc"), "enter");
});
