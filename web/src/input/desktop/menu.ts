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
  | { id: "confirm"; action: PowerAction };

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
  | { kind: "close"; label: string };

export type MenuLayout = Partial<Record<MenuSector, MenuItem>>;

/** An app the helper can open (from its apps.json). */
export interface Launcher {
  id: string;
  name: string;
}

const POWER: Record<PowerAction, { icon: string; name: string }> = {
  suspend: { icon: "🌙", name: "Suspend" },
  restart: { icon: "🔄", name: "Restart" },
  shutdown: { icon: "⏻", name: "Shut down" },
};

/** Cells for apps, in reading order; ↓ is always "Back". */
export const APP_CELLS: readonly MenuSector[] = ["up_left", "up", "up_right", "left", "right", "down_left", "down_right"];

/** Empty slots shown while no app is configured. */
const PLACEHOLDER_SLOTS = 3;

const BACK: MenuItem = { kind: "page", page: { id: "main" }, label: "↩ Back" };

/** The options of a page. The layout is fixed, so each option is always in the same place. */
export function menuPage(page: MenuPage, context: DesktopContext, launchers: readonly Launcher[] = []): MenuLayout {
  switch (page.id) {
    case "main":
      return {
        up: { kind: "level", target: "volume", label: "🔊 Volume" },
        down: { kind: "level", target: "brightness", label: "🔆 Brightness" },
        // In a call, the call's own mute (the others see the icon); otherwise the system microphone.
        left:
          context === "call"
            ? { kind: "action", action: "toggle_mic", label: "🎙️ Microphone" }
            : { kind: "action", action: "mic_mute", label: "🎙️ Microphone" },
        right: { kind: "page", page: { id: "apps" }, label: "🚀 Apps ▸" },
        down_right: { kind: "page", page: { id: "computer" }, label: "⏻ Computer ▸" },
        ...(context === "call"
          ? {
              up_left: { kind: "action", action: "raise_hand", label: "✋ Raise hand" },
              down_left: { kind: "action", action: "leave_call", label: "📞 Leave call" },
            }
          : {}),
      };
    case "computer":
      return {
        up: { kind: "page", page: { id: "confirm", action: "suspend" }, label: `${POWER.suspend.icon} ${POWER.suspend.name}…` },
        left: { kind: "page", page: { id: "confirm", action: "restart" }, label: `${POWER.restart.icon} ${POWER.restart.name}…` },
        right: { kind: "page", page: { id: "confirm", action: "shutdown" }, label: `${POWER.shutdown.icon} ${POWER.shutdown.name}…` },
        down: BACK,
      };
    case "confirm": {
      // "Yes" sits alone at the bottom, away from where the previous page's options were: confirming
      // needs a deliberate move. Everywhere else cancels.
      const cancel: MenuItem = { kind: "close", label: "✕ Cancel" };
      const p = POWER[page.action];
      return { up: cancel, left: cancel, right: cancel, down: { kind: "power", action: page.action, label: `✔ Yes, ${p.name.toLowerCase()}` } };
    }
    case "apps": {
      const layout: MenuLayout = { down: BACK };
      const slots: MenuItem[] =
        launchers.length > 0
          ? launchers.slice(0, APP_CELLS.length).map((l) => ({ kind: "app", id: l.id, label: l.name }))
          : Array.from({ length: PLACEHOLDER_SLOTS }, (_, i) => ({ kind: "app", id: null, label: `App ${i + 1} · not set` }));
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
