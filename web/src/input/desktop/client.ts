// Talks to the Gesture Control helper (adapters/desktop): the local Go program that performs the
// actions on the real computer. Kept free of DOM code so it can be tested.

import type { Action } from "../actions.ts";
import type { MouseAction, Point } from "../types.ts";

/** Actions the helper can perform on the computer. The rest belong to the document reader. */
export const OS_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "enter",
  "escape",
  "next_tab",
  "previous_tab",
  "undo",
  "click",
  "volume",
  "toggle_mic",
  "toggle_camera",
  "raise_hand",
  "leave_call",
  "brightness",
  "mic_mute",
  "suspend",
  "restart",
  "shutdown",
  "open_app",
  "keyboard",
]);

export type CallAppId = "meet" | "zoom" | "teams";

export interface HelperStatus {
  platform: string;
  desktop: string;
  dryRun: boolean;
  apps: { id: CallAppId; name: string }[];
  /** Apps the helper can open (its apps.json); empty when none is configured. */
  launchers?: { id: string; name: string }[];
}

export interface ActionOptions {
  /** 0–1, for volume and brightness. */
  value?: number;
  /** Video-call app. */
  app?: CallAppId;
  /** Required for suspend, restart and shut down (the user confirmed in the menu). */
  confirm?: boolean;
  /** App to open (an id from launchers). */
  target?: string;
}

/**
 * Maps the pointer from camera-image coordinates to the screen. The image is mirrored for the user,
 * and only the central part of the camera is used (`margin` on each side) so the screen edges can
 * be reached without leaving the camera's field of view. A larger margin means less hand movement
 * for the same cursor movement (0.26: the central 48 % of the image covers the whole screen).
 */
export function toScreen(p: Point, mirror = true, margin = 0.26): Point {
  const x = mirror ? 1 - p.x : p.x;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const span = 1 - 2 * margin;
  return { x: clamp((x - margin) / span), y: clamp((p.y - margin) / span) };
}

export class HelperClient {
  private pointerBusy = false;
  /** Mouse buttons are never dropped and keep their order (a "down" must be followed by its "up"). */
  private buttons: Promise<unknown> = Promise.resolve();
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  // The default wraps the global fetch: calling it as a method of this object would throw
  // "Illegal invocation" in browsers.
  constructor(token: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private request(path: string, method: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(path, {
      method,
      headers: { "Content-Type": "application/json", "X-Gesture-Token": this.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async status(): Promise<HelperStatus> {
    const r = await this.request("/api/status", "GET");
    if (!r.ok) throw new Error(`status: HTTP ${r.status}`);
    return (await r.json()) as HelperStatus;
  }

  /** Performs an action; returns what the helper did. Throws with the helper's message on error. */
  async action(action: Action, options: ActionOptions = {}): Promise<string> {
    const r = await this.request("/api/action", "POST", { action, ...options });
    const data = (await r.json().catch(() => ({}))) as { did?: string; error?: string };
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data.did ?? action;
  }

  /** Presses or releases the mouse button, clicks or right-clicks at the current cursor position. */
  mouse(action: MouseAction | "scroll_up" | "scroll_down"): Promise<void> {
    const next = this.buttons.then(async () => {
      const r = await this.request("/api/mouse", "POST", { action });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
    });
    this.buttons = next.catch(() => {});
    return next;
  }

  /** Moves the mouse. Drops the update if the previous one hasn't finished (no queue build-up). */
  async pointer(p: Point): Promise<void> {
    if (this.pointerBusy) return;
    this.pointerBusy = true;
    try {
      await this.request("/api/pointer", "POST", { x: p.x, y: p.y });
    } finally {
      this.pointerBusy = false;
    }
  }
}

/**
 * Sends only the newest value: while a request is running, newer values replace each other and only
 * the last one is sent when it finishes. For volume and brightness, whose system calls can be slower
 * than the hand moves.
 */
export function latestOnly<T>(send: (v: T) => Promise<unknown>): (v: T) => void {
  let busy = false;
  let pending: { v: T } | null = null;
  const push = (v: T): void => {
    if (busy) {
      pending = { v };
      return;
    }
    busy = true;
    void send(v)
      .catch(() => {})
      .finally(() => {
        busy = false;
        const next = pending;
        pending = null;
        if (next) push(next.v);
      });
  };
  return push;
}

/**
 * A fetch for HelperClient that reaches the helper's API through a call instead of HTTP: inside the
 * desktop app, Go's GestureCall binding answers it in-process ({"status", "body"} as JSON text).
 */
export function bindingFetch(call: (method: string, path: string, body: string) => Promise<string>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const body = typeof init?.body === "string" ? init.body : "";
    const r = JSON.parse(await call(init?.method ?? "GET", path, body)) as { status: number; body: string };
    // A 204 response can't carry a body.
    return new Response(r.status === 204 || r.body === "" ? null : r.body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}
