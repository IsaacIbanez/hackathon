import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPose } from "../poses.ts";
import { makeHand, SHAPES } from "./hand.ts";

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`pose ${name}`, () => {
    assert.equal(classifyPose(makeHand(shape)), name);
  });
}

test("the pose doesn't change when the hand moves across the image", () => {
  assert.equal(classifyPose(makeHand({ ...SHAPES.point, dx: -0.3, dy: 0.1 })), "point");
});

test("index and middle up is pointing: there is no victory gesture (it looked like the click)", () => {
  assert.equal(classifyPose(makeHand({ index: true, middle: true })), "point");
});

test("index, middle and ring up (pinky folded) is the three-finger gesture", () => {
  assert.equal(classifyPose(makeHand({ index: true, middle: true, ring: true })), "three");
  // With the pinky up too it is the open palm, not three.
  assert.equal(classifyPose(makeHand({ thumb: "out", index: true, middle: true, ring: true, pinky: true })), "palm");
});
