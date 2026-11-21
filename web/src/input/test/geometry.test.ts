import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHomography, documentHomography } from "../geometry.ts";
import type { Corners } from "../types.ts";

test("the homography maps the document corners to the unit square", () => {
  // Document seen in perspective (a trapezoid).
  const corners: Corners = [
    { x: 0.3, y: 0.2 },
    { x: 0.7, y: 0.25 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.85 },
  ];
  const h = documentHomography(corners);
  assert.ok(h);
  const expected = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  corners.forEach((c, i) => {
    const r = applyHomography(h, c)!;
    assert.ok(Math.abs(r.x - expected[i][0]) < 1e-9 && Math.abs(r.y - expected[i][1]) < 1e-9);
  });
});

test("degenerate corners return null", () => {
  const p = { x: 0.5, y: 0.5 };
  assert.equal(documentHomography([p, p, p, p]), null);
});
