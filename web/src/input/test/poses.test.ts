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

test("three extended fingers is not a known gesture", () => {
  assert.equal(classifyPose(makeHand({ index: true, middle: true, ring: true })), "none");
});
