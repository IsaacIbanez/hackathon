// Talks to the Gesture Control helper (adapters/desktop): the local Go program that performs the
// actions on the real computer. Kept free of DOM code so it can be tested.

import type { Action } from "../actions.ts";
import type { Point } from "../types.ts";

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
]);

export type CallAppId = "meet" | "zoom" | "teams";

export interface HelperStatus {
  platform: string;
  desktop: string;
  dryRun: boolean;
  apps: { id: CallAppId; name: string }[];
}

/**
 * Maps the pointer from camera-image coordinates to the screen. The image is mirrored for the user,
 * and only the central part of the camera is used (`margin` on each side) so the screen edges can
 * be reached without leaving the camera's field of view.
 */
export function toScreen(p: Point, mirror = true, margin = 0.15): Point {
  const x = mirror ? 1 - p.x : p.x;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const span = 1 - 2 * margin;
  return { x: clamp((x - margin) / span), y: clamp((p.y - margin) / span) };
}

export class HelperClient {
  private pointerBusy = false;
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
  async action(action: Action, options: { value?: number; app?: CallAppId } = {}): Promise<string> {
    const r = await this.request("/api/action", "POST", { action, ...options });
    const data = (await r.json().catch(() => ({}))) as { did?: string; error?: string };
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data.did ?? action;
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
