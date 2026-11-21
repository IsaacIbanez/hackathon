import { test } from "node:test";
import assert from "node:assert/strict";
import { HelperClient, OS_ACTIONS, toScreen } from "../desktop/client.ts";

const near = (a: { x: number; y: number }, x: number, y: number) =>
  assert.ok(Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9, JSON.stringify(a));

test("toScreen mirrors the image and uses the central part of the camera", () => {
  // Image right edge (user's left) → screen left; the margin maps to the screen edges.
  near(toScreen({ x: 0.85, y: 0.15 }), 0, 0);
  near(toScreen({ x: 0.15, y: 0.85 }), 1, 1);
  near(toScreen({ x: 0.5, y: 0.5 }), 0.5, 0.5);
  // Beyond the margin it clamps instead of leaving the screen.
  near(toScreen({ x: 1, y: 1 }), 0, 1);
});

test("only computer and call actions go to the helper", () => {
  for (const a of ["toggle_mic", "raise_hand", "volume", "click", "enter"] as const) assert.ok(OS_ACTIONS.has(a));
  for (const a of ["read", "explain_here", "ask_for_help"] as const) assert.ok(!OS_ACTIONS.has(a));
});

test("the client sends the token and reports the helper's errors", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const ok = JSON.parse(String(init.body)).action === "toggle_mic";
    return new Response(JSON.stringify(ok ? { did: "toggle_mic in Zoom" } : { error: "unknown action" }), {
      status: ok ? 200 : 422,
    });
  }) as unknown as typeof fetch;
  const client = new HelperClient("tok", fake);
  assert.equal(await client.action("toggle_mic", { app: "zoom" }), "toggle_mic in Zoom");
  await assert.rejects(client.action("read"), /unknown action/);
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Gesture-Token"], "tok");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action: "toggle_mic", app: "zoom" });
});
