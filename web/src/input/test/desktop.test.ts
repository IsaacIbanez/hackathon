import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingFetch, HelperClient, latestOnly, OS_ACTIONS, toScreen } from "../desktop/client.ts";
import { APP_CELLS, cellsOf, menuPage, micStateOf } from "../desktop/menu.ts";

const near = (a: { x: number; y: number }, x: number, y: number) =>
  assert.ok(Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9, JSON.stringify(a));

test("toScreen mirrors the image and uses a small area high up in the camera", () => {
  // Image right edge (user's left) → screen left; the area's edges map to the screen edges.
  near(toScreen({ x: 0.73, y: 0.06 }), 0, 0);
  near(toScreen({ x: 0.27, y: 0.5 }), 1, 1);
  near(toScreen({ x: 0.5, y: 0.28 }), 0.5, 0.5);
  // The bottom of the screen is reached with the fingertip at half the image height, so the hand
  // below it stays in view; beyond the area it clamps instead of leaving the screen.
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

test("menu: the main page has volume, brightness, microphone, apps, computer and the two closes", () => {
  const pc = menuPage({ id: "main" }, "pc");
  // Power (Computer ▸) is not offered unless allowed (R2).
  assert.deepEqual(cellsOf(pc).sort(), ["down", "down_left", "left", "right", "up", "up_left", "up_right"]);
  const withPower = menuPage({ id: "main" }, "pc", [], false, true);
  assert.equal(withPower.down_right?.kind === "page" && withPower.down_right.page.id, "computer");
  assert.equal(pc.up_left?.kind, "main_menu"); // back to the overlay's main menu, gestures still on
  assert.equal(pc.left?.kind, "quit"); // "Close app", in red
  assert.equal(pc.left?.label, "Close app");
  assert.equal(pc.up_right?.kind, "cursor");
  assert.equal(menuPage({ id: "main" }, "pc", [], true).up_right?.label, "Cursor off");
  assert.deepEqual(pc.up, { kind: "level", target: "volume", label: "Volume" });
  assert.equal(pc.down?.kind === "level" && pc.down.target, "brightness");
  // The system microphone is a toggle whose label shows its state once known.
  assert.equal(pc.down_left?.kind === "action" && pc.down_left.action, "mic_mute");
  assert.equal(pc.down_left?.label, "Microphone");
  assert.equal(menuPage({ id: "main" }, "pc", [], false, false, true).down_left?.label, "Mic: muted");
  assert.equal(menuPage({ id: "main" }, "pc", [], false, false, false).down_left?.label, "Mic: on");
  // In a call the main page is the same; "Raise hand" is in Apps, after the keyboard.
  const call = menuPage({ id: "main" }, "call");
  assert.deepEqual(call, pc);
  const callApps = menuPage({ id: "apps" }, "call");
  assert.equal(callApps.up?.kind === "action" && callApps.up.action, "raise_hand");
});

test("menu: power actions need two confirmations, in different corners (R2)", () => {
  const computer = menuPage({ id: "computer" }, "pc");
  for (const item of Object.values(computer)) assert.notEqual(item?.kind, "power");
  for (const action of ["suspend", "restart", "shutdown"] as const) {
    const go = Object.values(computer).find((i) => i?.kind === "page" && i.page.id === "confirm" && i.page.action === action);
    assert.ok(go, action);
    // First "yes" (↓) leads to a second page, not to the action.
    const confirm = menuPage({ id: "confirm", action }, "pc");
    assert.ok(Object.values(confirm).every((i) => i?.kind !== "power"));
    assert.deepEqual(confirm.down, { kind: "page", page: { id: "confirm2", action }, label: confirm.down!.label });
    // The final "yes" is in the top-left corner, far from the first one.
    const confirm2 = menuPage({ id: "confirm2", action }, "pc");
    const yes = Object.entries(confirm2).filter(([, i]) => i?.kind === "power");
    assert.deepEqual(yes.map(([s]) => s), ["up_left"]);
  }
});

test("menu: apps come from the helper; without any, placeholder slots", () => {
  const empty = menuPage({ id: "apps" }, "pc", []);
  assert.equal(empty.up_left?.kind === "action" && empty.up_left.action, "keyboard"); // always first
  const slots = Object.values(empty).filter((i) => i?.kind === "app");
  assert.equal(slots.length, 3);
  assert.ok(slots.every((i) => i?.kind === "app" && i.id === null));
  assert.equal(empty.down?.kind === "page" && empty.down.page.id, "main");

  const many = Array.from({ length: 9 }, (_, i) => ({ id: `app${i}`, name: `App ${i}` }));
  const full = menuPage({ id: "apps" }, "pc", many);
  const ids = APP_CELLS.map((c) => full[c]).map((i) => i?.kind === "app" && i.id);
  assert.deepEqual(ids, [false, "app0", "app1", "app2", "app3", "app4", "app5"]); // keyboard first; the rest don't fit
  assert.equal(full.down?.kind, "page"); // ↓ is always Back
});

test("bindingFetch sends the request through the call and rebuilds the response", async () => {
  const calls: string[][] = [];
  const call = async (method: string, path: string, body: string) => {
    calls.push([method, path, body]);
    return path === "/api/mouse"
      ? JSON.stringify({ status: 204, body: "" })
      : JSON.stringify({ status: 200, body: JSON.stringify({ did: "enter" }) });
  };
  const client = new HelperClient("", bindingFetch(call));
  assert.equal(await client.action("enter"), "enter");
  await client.mouse("click");
  assert.deepEqual(calls, [
    ["POST", "/api/action", JSON.stringify({ action: "enter" })],
    ["POST", "/api/mouse", JSON.stringify({ action: "click" })],
  ]);
});

test("microphone: the helper's answer gives the real state", () => {
  assert.equal(micStateOf("microphone muted"), true);
  assert.equal(micStateOf("microphone on"), false);
  assert.equal(micStateOf("unmuted"), false);
  assert.equal(micStateOf("microphone toggled"), null);
});

test("microphone: micMuted reads GET /api/mic, null when the helper cannot tell", async () => {
  const answer = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  assert.equal(await new HelperClient("", answer(200, { muted: true })).micMuted(), true);
  assert.equal(await new HelperClient("", answer(200, { muted: false })).micMuted(), false);
  assert.equal(await new HelperClient("", answer(501, { error: "not supported" })).micMuted(), null);
  const failing = async () => {
    throw new Error("down");
  };
  assert.equal(await new HelperClient("", failing).micMuted(), null);
});
