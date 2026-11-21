import { test } from "node:test";
import assert from "node:assert/strict";
import { HelperClient, latestOnly, OS_ACTIONS, toScreen } from "../desktop/client.ts";
import { APP_CELLS, cellsOf, menuPage } from "../desktop/menu.ts";

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

test("the client keeps the order of mouse buttons, even when a request is slow", async () => {
  const order: string[] = [];
  let first = true;
  const fake = (async (_url: string, init: RequestInit) => {
    const { action } = JSON.parse(String(init.body)) as { action: string };
    // The first request ("down") is the slowest: "up" must still go after it.
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 20));
    }
    order.push(action);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const client = new HelperClient("tok", fake);
  await Promise.all([client.mouse("down"), client.mouse("up")]);
  assert.deepEqual(order, ["down", "up"]);
});

test("latestOnly sends the newest value and drops the ones in between", async () => {
  const sent: number[] = [];
  let release!: () => void;
  const push = latestOnly(async (v: number) => {
    sent.push(v);
    if (v === 1) await new Promise<void>((r) => (release = r));
  });
  push(1); // in flight
  push(2);
  push(3); // replaces 2
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [1, 3]);
});

test("new actions go to the helper: brightness, microphone, power and apps", () => {
  for (const a of ["brightness", "mic_mute", "suspend", "restart", "shutdown", "open_app"] as const) {
    assert.ok(OS_ACTIONS.has(a), a);
  }
});

// ---- Gesture Control quick menu ----

test("menu: the main page has volume, brightness, microphone, apps and computer", () => {
  const pc = menuPage({ id: "main" }, "pc");
  assert.deepEqual(cellsOf(pc).sort(), ["down", "down_right", "left", "right", "up"]);
  assert.deepEqual(pc.up, { kind: "level", target: "volume", label: "🔊 Volume" });
  assert.equal(pc.down?.kind === "level" && pc.down.target, "brightness");
  assert.equal(pc.left?.kind === "action" && pc.left.action, "mic_mute"); // the system microphone
  // In a call: the call's own mute, plus raising your hand and leaving the call.
  const call = menuPage({ id: "main" }, "call");
  assert.equal(call.left?.kind === "action" && call.left.action, "toggle_mic");
  assert.equal(call.up_left?.kind === "action" && call.up_left.action, "raise_hand");
  assert.equal(call.down_left?.kind === "action" && call.down_left.action, "leave_call");
});

test("menu: power actions always ask first, and only ↓ confirms", () => {
  const computer = menuPage({ id: "computer" }, "pc");
  for (const item of Object.values(computer)) assert.notEqual(item?.kind, "power");
  for (const action of ["suspend", "restart", "shutdown"] as const) {
    const go = Object.values(computer).find((i) => i?.kind === "page" && i.page.id === "confirm" && i.page.action === action);
    assert.ok(go, action);
    const confirm = menuPage({ id: "confirm", action }, "pc");
    const yes = Object.entries(confirm).filter(([, i]) => i?.kind === "power");
    assert.deepEqual(yes.map(([s]) => s), ["down"]);
    assert.ok(Object.entries(confirm).every(([s, i]) => s === "down" || i?.kind === "close"));
  }
});

test("menu: apps come from the helper; without any, placeholder slots", () => {
  const empty = menuPage({ id: "apps" }, "pc", []);
  const slots = Object.values(empty).filter((i) => i?.kind === "app");
  assert.equal(slots.length, 3);
  assert.ok(slots.every((i) => i?.kind === "app" && i.id === null));
  assert.equal(empty.down?.kind === "page" && empty.down.page.id, "main");

  const many = Array.from({ length: 9 }, (_, i) => ({ id: `app${i}`, name: `App ${i}` }));
  const full = menuPage({ id: "apps" }, "pc", many);
  const ids = APP_CELLS.map((c) => full[c]).map((i) => i?.kind === "app" && i.id);
  assert.deepEqual(ids, ["app0", "app1", "app2", "app3", "app4", "app5", "app6"]); // the rest don't fit
  assert.equal(full.down?.kind, "page"); // ↓ is always Back
});
