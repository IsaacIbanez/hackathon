// Maps hand and head events to app actions. This is the part the rest of the team sees:
// "what the user wants to do", without landmark details.
//
// Few gestures, many actions: the same gesture means different things depending on the context
// (reading a document, filling in a form, using the computer, or in a video call).

import type { HandEvent, HandSide, HeadGesture, MenuSector } from "./types.ts";

export type Context = "document" | "form" | "pc" | "call";

export type Action =
  // Document
  | "read"
  | "pause"
  | "next"
  | "previous"
  | "explain_here"
  // Form
  | "confirm_field"
  | "next_field"
  | "previous_field"
  | "dictate_field"
  | "clear_field"
  // Computer
  | "enter"
  | "escape"
  | "next_tab"
  | "previous_tab"
  | "click"
  // Video call
  | "toggle_mic"
  | "toggle_camera"
  | "raise_hand"
  | "leave_call"
  // Shared
  | "undo"
  | "volume"
  | "wake"
  | "sleep"
  // Quick menu
  | "adjust_volume"
  | "repeat"
  | "copy_text"
  | "dictate"
  | "ask_for_help";

interface ContextMap {
  thumbs_up: Action;
  thumbs_down: Action;
  palm: Action;
  swipe_right: Action | null;
  swipe_left: Action | null;
  select: Action;
  /** Continuous control with the pinch; the value is in event.value (0–1). */
  pinch: Action | null;
  head: Record<HeadGesture, Action>;
}

export const MAPS: Record<Context, ContextMap> = {
  document: {
    thumbs_up: "read",
    thumbs_down: "undo",
    palm: "pause",
    swipe_right: "next",
    swipe_left: "previous",
    select: "explain_here",
    pinch: "volume",
    head: { nod: "read", shake: "pause" },
  },
  form: {
    thumbs_up: "confirm_field",
    thumbs_down: "clear_field",
    palm: "pause",
    swipe_right: "next_field",
    swipe_left: "previous_field",
    select: "dictate_field",
    pinch: "volume",
    head: { nod: "confirm_field", shake: "clear_field" },
  },
  pc: {
    thumbs_up: "enter",
    thumbs_down: "undo",
    palm: "escape",
    swipe_right: "next_tab",
    swipe_left: "previous_tab",
    select: "click",
    pinch: "volume",
    head: { nod: "enter", shake: "escape" },
  },
  // In a video call: ✋ raises your hand, 👍 mutes/unmutes, 👎 turns the camera on/off. Swipes do
  // nothing (people move their hands while talking); leaving the call is in the quick menu.
  call: {
    thumbs_up: "toggle_mic",
    thumbs_down: "toggle_camera",
    palm: "raise_hand",
    swipe_right: null,
    swipe_left: null,
    select: "click",
    pinch: "volume",
    head: { nod: "raise_hand", shake: "toggle_mic" },
  },
};

/** Quick menu (✌️) options when the hand in use is unknown; the same in every context. */
export const QUICK_MENU: Record<MenuSector, Action> = {
  up: "adjust_volume",
  right: "dictate",
  down: "repeat",
  left: "ask_for_help",
};

/**
 * Menu for a given hand and context: that hand's side is removed (moving the pointer outwards is
 * awkward) and "ask for help" always sits on the comfortable side, so it is never lost. "Dictate" is
 * dropped. In a video call, ↓ leaves the call (behind the menu so it can't happen by accident).
 */
export function menuFor(hand: HandSide | null, context: Context = "document"): Partial<Record<MenuSector, Action>> {
  const base: Record<MenuSector, Action> = context === "call" ? { ...QUICK_MENU, down: "leave_call" } : QUICK_MENU;
  if (!hand) return base;
  const otherSide: MenuSector = hand === "right" ? "left" : "right";
  return { up: base.up, down: base.down, [otherSide]: "ask_for_help" };
}

/**
 * Action for an event in a context, or null if the event is not an action (pointer, hand
 * presence, menu opening…). For "level" (pinch) it returns the action in the "move" and "end"
 * phases: the value (0–1) is in event.value.
 */
export function actionFor(event: HandEvent, context: Context = "document"): Action | null {
  const m = MAPS[context];
  switch (event.type) {
    case "gesture":
      if (event.gesture === "thumbs_up") return m.thumbs_up;
      if (event.gesture === "thumbs_down") return m.thumbs_down;
      if (event.gesture === "palm") return m.palm;
      return null; // victory opens the menu; the rest have no action of their own
    case "swipe":
      return event.direction === "right" ? m.swipe_right : m.swipe_left;
    case "select":
      return m.select;
    case "level":
      return event.phase === "move" || event.phase === "end" ? m.pinch : null;
    case "menu":
      return event.phase === "choose" && event.sector ? (menuFor(event.hand, context)[event.sector] ?? null) : null;
    case "head":
      return m.head[event.gesture];
    case "mode":
      return event.awake ? "wake" : "sleep";
    default:
      return null;
  }
}
