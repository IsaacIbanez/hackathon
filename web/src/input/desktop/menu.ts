// Quick menu of the Gesture Control window: pages of options on a 3×3 screen grid (centre empty).
// ✊ opens the main page; some options open another page (computer power, apps). Kept free of DOM
// code so it can be tested.

import type { Action } from "../actions.ts";
import type { LevelTarget, MenuSector } from "../types.ts";

export type DesktopContext = "pc" | "call";
export type PowerAction = "suspend" | "restart" | "shutdown";

export type MenuPage =
  | { id: "main" }
  | { id: "computer" }
  | { id: "apps" }
  /** "Are you sure?" before a power action. */
  | { id: "confirm"; action: PowerAction }
  /** Second "are you sure?": power needs two confirmations in different corners. */
  | { id: "confirm2"; action: PowerAction };

export type MenuItem =
  /** Performs a computer or video-call action. */
  | { kind: "action"; action: Action; label: string }
  /** Arms the pinch control (volume or brightness). */
  | { kind: "level"; target: LevelTarget; label: string }
  /** Shows another page. */
  | { kind: "page"; page: MenuPage; label: string }
  /** Performs a power action (only offered on the confirmation page). */
  | { kind: "power"; action: PowerAction; label: string }
  /** Opens an app from the helper's list; id null is an empty slot. */
  | { kind: "app"; id: string | null; label: string }
  /** Closes the menu without doing anything. */
  | { kind: "close"; label: string }
  /** Closes the assistant (the whole app). */
  | { kind: "quit"; label: string }
  /** Turns off only Gesture Control (the camera); the rest of the app keeps running. */
  | { kind: "gestures_off"; label: string }
  /** Turns cursor mode (the gesture mouse) on or off. */
  | { kind: "cursor"; label: string };

export type MenuLayout = Partial<Record<MenuSector, MenuItem>>;

/** An app the helper can open (from its apps.json). */
export interface Launcher {
  id: string;
  name: string;
}

const POWER: Record<PowerAction, { icon: string; name: string }> = {
  suspend: { icon: "", name: "Suspend" },
  restart: { icon: "", name: "Restart" },
  shutdown: { icon: "", name: "Shut down" },
};

/** Cells for apps, in reading order; ↓ is always "Back". */
export const APP_CELLS: readonly MenuSector[] = ["up_left", "up", "up_right", "left", "right", "down_left", "down_right"];

/** Empty slots shown while no app is configured. */
const PLACEHOLDER_SLOTS = 3;

const BACK: MenuItem = { kind: "page", page: { id: "main" }, label: "Back" };
const KEYBOARD: MenuItem = { kind: "action", action: "keyboard", label: "Keyboard" };
const RAISE_HAND: MenuItem = { kind: "action", action: "raise_hand", label: "Raise hand" };

/** The microphone option's label: a toggle that shows its state once known (null: not known yet). */
export function micLabel(muted: boolean | null): string {
  return muted === null ? "Microphone" : muted ? "Mic: muted" : "Mic: on";
}

/** The options of a page. The layout is fixed, so each option is always in the same place. */
export function menuPage(
  page: MenuPage,
  context: DesktopContext,
  launchers: readonly Launcher[] = [],
  cursorOn = false,
  /** Whether suspend, restart and shut down are allowed (off by default: the helper's status). */
  powerOn = false,
  /** Whether the system microphone is muted, as the helper last said (null: not known yet). */
  micMuted: boolean | null = null,
): MenuLayout {
  switch (page.id) {
    case "main":
      return {
        up: { kind: "level", target: "volume", label: "Volume" },
        down: { kind: "level", target: "brightness", label: "Brightness" },
        // Turns off only the gestures (the camera); the overlay stays.
        up_left: { kind: "gestures_off", label: "Close gestures" },
        // Close the whole app, in every context (shown in red).
        left: { kind: "quit", label: "Close app" },
        // The system microphone: it works with any app (👍 toggles the call app's own mute). A toggle:
        // choosing it keeps the menu open and flips its label.
        down_left: { kind: "action", action: "mic_mute", label: micLabel(micMuted) },
        right: { kind: "page", page: { id: "apps" }, label: "Apps ▸" },
        // Power (suspend, restart, shut down) only when allowed: a gesture once suspended the computer.
        ...(powerOn ? { down_right: { kind: "page", page: { id: "computer" }, label: "Computer ▸" } as MenuItem } : {}),
        up_right: { kind: "cursor", label: cursorOn ? "Cursor off" : "Cursor mode" },
      };
    case "computer":
      return {
        up: { kind: "page", page: { id: "confirm", action: "suspend" }, label: `${POWER.suspend.name}…` },
        left: { kind: "page", page: { id: "confirm", action: "restart" }, label: `${POWER.restart.name}…` },
        right: { kind: "page", page: { id: "confirm", action: "shutdown" }, label: `${POWER.shutdown.name}…` },
        down: BACK,
      };
    case "confirm": {
      const p = POWER[page.action];
      return {
        up: { kind: "page", page: { id: "computer" }, label: "Back" },
        down: { kind: "page", page: { id: "confirm2", action: page.action }, label: `Yes, ${p.name.toLowerCase()}` },
      };
    }
    case "confirm2": {
      // The final "yes" is in the opposite top corner from the first one: two deliberate moves.
      const p = POWER[page.action];
      return {
        down: { kind: "page", page: { id: "computer" }, label: "Cancel" },
        up_left: { kind: "power", action: page.action, label: `Sure: ${p.name.toLowerCase()} now` },
      };
    }
    case "apps": {
      const layout: MenuLayout = { down: BACK };
      // The on-screen keyboard is always the first one, then "Raise hand" in a call.
      const fixed: MenuItem[] = context === "call" ? [KEYBOARD, RAISE_HAND] : [KEYBOARD];
      const slots: MenuItem[] = [
        ...fixed,
        ...(launchers.length > 0
          ? launchers.slice(0, APP_CELLS.length - fixed.length).map((l): MenuItem => ({ kind: "app", id: l.id, label: l.name }))
          : Array.from({ length: PLACEHOLDER_SLOTS }, (_, i): MenuItem => ({ kind: "app", id: null, label: `App ${i + 1} · not set` }))),
      ];
      slots.forEach((item, i) => (layout[APP_CELLS[i]] = item));
      return layout;
    }
  }
}

/** Cells that have an option (for HandInteraction.setMenuCells). */
export function cellsOf(layout: MenuLayout): MenuSector[] {
  return (Object.keys(layout) as MenuSector[]).filter((s) => layout[s]);
}

/** Text spoken or shown after choosing a power action. */
export function powerLabel(action: PowerAction): string {
  return POWER[action].name;
}
