// How one option of the fist menu looks (docs/DESIGN.md): a drawn icon, its name, and its state
// when it is a toggle. Only the view: the options, their places and what they do stay in menu.ts.
import type { MenuItem } from "./menu.ts";

const ICONS: Record<string, string> = {
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  brightness: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  home: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  handOff: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.5L4.3 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/><path d="M3 3l18 18"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/><path d="M3 3l18 18"/>',
  apps: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.5L4.3 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/>',
  app: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

function svg(name: string): string {
  return `<svg class="op-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Icon, name and state (for toggles) of an option, from what menu.ts says about it. */
export function optionParts(item: MenuItem | undefined, text: string): { icon: string; name: string; state?: string; more?: boolean } {
  const name = text.replace(/\s*▸$/, "");
  const more = name !== text;
  if (!item) return { icon: "check", name };
  switch (item.kind) {
    case "level":
      return { icon: item.target === "volume" ? "volume" : "brightness", name };
    case "main_menu":
      return { icon: "home", name };
    case "quit":
    case "power":
      return { icon: "power", name };
    case "cursor":
      // "Cursor off" is shown while it is on: choosing it turns it off.
      return { icon: "cursor", name: "Cursor mode", state: text === "Cursor off" ? "On" : "Off" };
    case "close":
      return { icon: "close", name };
    case "app": {
      const [app, rest] = name.split(" · ");
      return { icon: item.id === null ? "app" : "apps", name: app, state: rest ? rest[0].toUpperCase() + rest.slice(1) : undefined };
    }
    case "action":
      if (item.action === "mic_mute") {
        const state = text.startsWith("Mic: ") ? text.slice(5) : undefined;
        return { icon: state === "muted" ? "micOff" : "mic", name: "Microphone", state: state && state[0].toUpperCase() + state.slice(1) };
      }
      if (item.action === "keyboard") return { icon: "keyboard", name };
      if (item.action === "raise_hand") return { icon: "hand", name };
      return { icon: "check", name };
    case "page": {
      const id = item.page.id;
      if (name === "Back" || name === "Cancel") return { icon: "back", name };
      if (id === "apps") return { icon: "apps", name, more };
      if (id === "computer") return { icon: "computer", name, more };
      if (id === "confirm2") return { icon: "check", name };
      return { icon: "power", name, more };
    }
  }
}

/** The option's markup: icon, name, and its state or "more" mark. */
export function optionHtml(item: MenuItem | undefined, text: string): string {
  const p = optionParts(item, text);
  const tail = p.state
    ? `<span class="op-state">${esc(p.state)}</span>`
    : p.more
      ? '<span class="op-state">More</span>'
      : "";
  return `${svg(p.icon)}<span class="op-name">${esc(p.name)}</span>${tail}`;
}
