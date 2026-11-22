// Gesture Control camera page, mountable anywhere (its own window, or option 1 of the desktop app):
// recognizes hand gestures and sends the computer and video-call actions to
// the local helper (adapters/desktop), which performs them on the real computer.
//
// - The detector sleeps until a strict open palm (fingers straight and spread, facing the camera)
//   wakes it, and goes back to sleep after a while without gestures.
// - ✊ opens the quick menu: volume, brightness, microphone, apps and computer (power) options.
// - With "Move the mouse", ☝️ moves the cursor and touching the middle fingertip to the thumb clicks
//   (twice quickly: right click; holding: drag).
import { actionFor, MAPS, type Action } from "../actions.ts";
import { HandInteraction, type WakeIssue } from "../interaction.ts";
import { createTracker } from "../tracker.ts";
import { CONNECTIONS, L, type HandEvent, type HandFrame, type LevelTarget, type MenuSector, type MouseAction } from "../types.ts";
import { latestOnly, OS_ACTIONS, toScreen, type ActionOptions, type CallAppId, type HelperClient } from "./client.ts";
import { MARKUP } from "./markup.ts";
import "./gestureControl.css";
import { cellsOf, menuPage, powerLabel, type DesktopContext, type Launcher, type MenuPage } from "./menu.ts";

export interface GestureControlOptions {
  /** Status text when the helper can't be reached. */
  unreachable?: string;
  /**
   * Called when the page starts or stops needing the whole screen: while the menu is open or the
   * volume/brightness is being adjusted (the desktop app then spreads its window over the screen).
   */
  onScreenOverlay?: (need: boolean) => void;
}

export interface GestureControlHandle {
  /** Stops the camera and the tracker and empties the root. */
  stop(): void;
  /** Shows only the camera (the desktop app's corner bubble). */
  setCompact(on: boolean): void;
  /**
   * See-through over the whole screen: only the menu, the hints and a small camera preview are
   * painted; the rest of the page is transparent.
   */
  setScreen(on: boolean): void;
}

/** Builds the camera page inside root and starts it; the helper performs the actions. */
export function mountGestureControl(
  root: HTMLElement,
  helper: HelperClient,
  options: GestureControlOptions = {},
): GestureControlHandle {
  root.classList.add("gc");
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  const video = $<HTMLVideoElement>("video");
  const canvas = $<HTMLCanvasElement>("canvas");
  const ctx = canvas.getContext("2d")!;

  const interaction = new HandInteraction({ requireWake: true, mouseClicks: true });
  let stopped = false;
  let screenNeeded = false;
  let tracker: { stop(): void } | null = null;

  let context: DesktopContext = "call";
  let page: MenuPage = { id: "main" };
  let launchers: Launcher[] = [];
  let lastFrame: HandFrame | null = null;
  let tAction = 0;
  /** The option just chosen, shown for a moment after the menu closes. */
  let chosen: { sector: MenuSector; label: string; t: number } | null = null;
  /** True while the page reopens the menu for a submenu (that "open" is not a new main menu). */
  let reopening = false;

  const LABELS: Partial<Record<Action, string>> = {
    enter: "Enter", escape: "Escape", next_tab: "Next tab", previous_tab: "Previous tab", undo: "Undo",
    click: "Click", volume: "Volume", toggle_mic: "Mute / unmute", toggle_camera: "Camera on / off",
    raise_hand: "Raise hand", leave_call: "Leave call", mic_mute: "Microphone on / off", brightness: "Brightness",
  };
  const label = (a: Action) => LABELS[a] ?? a.replaceAll("_", " ");

  const WAKE_HINTS: Record<WakeIssue | "none", string> = {
    none: "😴 Asleep — hold up an open palm, fingers spread, to wake",
    open: "✋ Open all five fingers",
    straight: "✋ Straighten your fingers",
    spread: "✋ Spread your fingers apart",
    facing: "✋ Turn your palm towards the camera",
    upright: "✋ Hold your hand upright",
  };
  const MOUSE_LABELS: Record<MouseAction, string> = {
    click: "🖱️ Click",
    right_click: "🖱️ Right click",
    down: "🖱️ Holding — move to drag",
    up: "🖱️ Released",
  };

  const enabled = () => $<HTMLInputElement>("enabled").checked;
  const mouseOn = () => $<HTMLInputElement>("mouse").checked;
  const app = () => $<HTMLSelectElement>("app").value as CallAppId;
  const layout = () => menuPage(page, context, launchers);

  function toast(text: string, error = false) {
    const el = $("action");
    el.textContent = text;
    el.classList.toggle("error", error);
    tAction = performance.now();
  }

  function log(text: string) {
    const li = document.createElement("li");
    li.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
    $("log").prepend(li);
    while ($("log").childElementCount > 40) $("log").lastElementChild!.remove();
  }

  /** Sends an action to the helper and reports the result. */
  async function perform(action: Action, options: ActionOptions = {}) {
    const all = { ...options, ...(context === "call" ? { app: app() } : {}) };
    try {
      const did = await helper.action(action, all);
      log(did);
      return did;
    } catch (e) {
      toast(`${label(action)}: ${(e as Error).message}`, true);
      log(`✗ ${label(action)}: ${(e as Error).message}`);
      return null;
    }
  }

  // System calls for volume and brightness can be slower than the hand: only the newest value is sent.
  const sendLevel: Record<LevelTarget, (v: number) => void> = {
    volume: latestOnly((v: number) => perform("volume", { value: v })),
    brightness: latestOnly((v: number) => perform("brightness", { value: v })),
  };

  // ---------- Menu ----------

  /** Shows a menu page: the controller only offers the cells this page uses. */
  function showPage(p: MenuPage) {
    page = p;
    interaction.setMenuCells(cellsOf(layout()));
  }

  function goBack(t: number) {
    if (page.id === "confirm") {
      showPage({ id: "computer" });
      reopening = true;
      try {
        interaction.reopenMenu(t);
      } finally {
        reopening = false;
      }
      toast("↩ Back");
      return;
    }
    if (page.id === "computer" || page.id === "apps") {
      showPage({ id: "main" });
      reopening = true;
      try {
        interaction.reopenMenu(t);
      } finally {
        reopening = false;
      }
      toast("↩ Back");
      return;
    }
    showPage({ id: "main" });
    interaction.closeMenu(t);
    toast("Closed");
  }

  function onMenu(e: Extract<HandEvent, { type: "menu" }>) {
    if (e.phase === "open") {
      if (!reopening) showPage({ id: "main" });
      return;
    }
    if (e.phase === "back") {
      goBack(e.t);
      return;
    }
    if (e.phase !== "choose" || !e.sector) return;
    const item = layout()[e.sector];
    if (!item) return;
    if (item.kind === "page") {
      showPage(item.page);
      reopening = true;
      try {
        interaction.reopenMenu(e.t);
      } finally {
        reopening = false;
      }
      return;
    }
    chosen = { sector: e.sector, label: item.label, t: performance.now() };
    showPage({ id: "main" });
    if (!enabled()) return;
    switch (item.kind) {
      case "level":
        interaction.startLevel(e.t, item.target);
        toast(`🤏 ${item.target === "brightness" ? "Brightness" : "Volume"}: pinch, then open your fingers`);
        break;
      case "action":
        toast(label(item.action));
        void perform(item.action).then((did) => {
          // The helper says whether the microphone ended up muted.
          if (did && item.action === "mic_mute") toast(`🎙️ ${did}`);
        });
        break;
      case "power":
        toast(`${powerLabel(item.action)}…`);
        void perform(item.action, { confirm: true });
        break;
      case "app":
        if (item.id) {
          toast(`🚀 ${item.label}`);
          void perform("open_app", { target: item.id });
        } else {
          toast("Empty slot: add apps to apps.json (see the README)", true);
        }
        break;
      case "close":
        toast("Cancelled");
        break;
    }
  }

  // ---------- Gestures → actions ----------

  interaction.on((e) => {
    if (e.type === "mode") {
      toast(e.awake ? "👋 Awake" : "😴 Asleep");
      return;
    }
    if (e.type === "menu") {
      onMenu(e);
      return;
    }
    if (!enabled()) return;

    if (e.type === "pointer") {
      if (mouseOn()) void helper.pointer(toScreen(e.image)).catch(() => {});
      return;
    }
    if (e.type === "mouse") {
      if (!mouseOn()) return;
      toast(MOUSE_LABELS[e.action]);
      helper.mouse(e.action).catch((err: Error) => toast(`Mouse: ${err.message}`, true));
      return;
    }

    const action = actionFor(e, context);
    if (!action) return;
    if (e.type === "level") {
      toast(`${e.target === "brightness" ? "🔆" : "🔊"} ${Math.round(e.value * 100)} %`);
      sendLevel[e.target](e.value);
      return;
    }
    // Clicks come from the click gesture (with "Move the mouse"), not from holding the pointer still.
    if (action === "click") return;
    if (!OS_ACTIONS.has(action)) {
      toast(`${label(action)} — not available here`, true);
      return;
    }
    toast(label(action));
    void perform(action);
  });

  // ---------- Controls ----------

  $("enabled").addEventListener("change", () => {
    $("enabledLabel").textContent = enabled() ? "On" : "Off";
    $("stage").classList.toggle("off", !enabled());
  });

  $("mouse").addEventListener("change", () => {
    interaction.configure({ mouseClicks: mouseOn() });
    paintGuide();
  });

  for (const b of root.querySelectorAll<HTMLButtonElement>("#context button")) {
    b.addEventListener("click", () => {
      context = b.dataset.c as DesktopContext;
      for (const o of root.querySelectorAll<HTMLButtonElement>("#context button")) {
        o.setAttribute("aria-pressed", String(o === b));
      }
      $("app").hidden = context !== "call";
      showPage({ id: "main" });
      paintGuide();
    });
  }

  function paintGuide() {
    const m = MAPS[context];
    $("contextName").textContent = context === "call" ? "Video call" : "Computer";
    const menu = Object.values(menuPage({ id: "main" }, context, launchers))
      .map((i) => i!.label.replace(/^\S+\s/, "").replace(" ▸", ""))
      .join(", ");
    const rows: [string, string | null][] = [
      ["✋ Open palm, fingers spread (hold ~1 s)", "Wake up"],
      ["👍 Thumbs up", m.thumbs_up && label(m.thumbs_up)],
      ["👎 Thumbs down", m.thumbs_down && label(m.thumbs_down)],
      ["✋→ / ✋← Swipe", m.swipe_right && m.swipe_left ? "Next / previous tab" : null],
      ["✊ Fist (hold) → ☝️ point + tap middle finger on thumb", `Menu: ${menu}`],
      ["✊ again, inside the menu", "Close the menu"],
      ["👎 Thumbs down / ✋← Swipe, in menu", "Go back / close"],
      ["☝️ Point", mouseOn() ? "Move the mouse" : "Move the mouse (turn on “Move the mouse”)"],
      ["☝️ + heart finger on thumb (middle fingertip)", "Click · twice quickly: right click · hold: drag"],
    ];
    $("guide").innerHTML = rows.map(([g, a]) => `<tr><td>${g}</td><td>${a ?? "—"}</td></tr>`).join("");
  }

  // ---------- Drawing ----------

  function paintMenu() {
    const t = performance.now();
    const open = interaction.menuOpen(t);
    const shownChoice = !open && chosen && t - chosen.t < 700 ? chosen : null;
    $("menu").hidden = !open && !shownChoice;
    const options = layout();
    for (const op of root.querySelectorAll<HTMLElement>("#menu .op")) {
      const s = op.dataset.s as MenuSector;
      const text = open ? options[s]?.label : shownChoice?.sector === s ? shownChoice.label : undefined;
      op.style.visibility = text ? "visible" : "hidden";
      op.textContent = text ?? "";
      op.classList.toggle("active", open?.sector === s);
      op.classList.toggle("chosen", shownChoice?.sector === s);
      op.style.setProperty("--p", open?.sector === s ? String(open.progress) : "0");
    }
    const titles: Record<MenuPage["id"], string> = { main: "Menu", computer: "Computer", apps: "Apps", confirm: "Are you sure?" };
    $("menuTitle").textContent = page.id === "confirm" ? `${powerLabel(page.action)}?` : titles[page.id];
    const p = interaction.pointer;
    const cursor = $("cursor");
    cursor.hidden = !(open && p);
    if (open && p) {
      cursor.style.left = `${(1 - p.x) * 100}%`;
      cursor.style.top = `${p.y * 100}%`;
    }
  }

  function paintSleep(t: number) {
    const asleep = !interaction.isAwake;
    $("stage").classList.toggle("asleep", asleep);
    const el = $("sleep");
    el.hidden = !asleep;
    if (!asleep) return;
    const progress = interaction.wakeProgress(t);
    el.textContent = progress > 0 ? "✋ Hold still…" : WAKE_HINTS[interaction.wakeHint ?? "none"];
    el.style.setProperty("--p", String(progress));
  }

  /** Volume or brightness being adjusted: the value, and how long until it is set. */
  function paintLevel(lvl: ReturnType<HandInteraction["levelActive"]>) {
    const el = $("level");
    el.hidden = !lvl && !interaction.levelArmed;
    if (el.hidden) return;
    const brightness = interaction.levelTargetName === "brightness";
    const icon = brightness ? "🔆" : "🔊";
    if (!lvl) {
      el.innerHTML = `${icon} <small>touch thumb and index, then open them</small>`;
      el.style.setProperty("--p", "0");
      return;
    }
    const hint = lvl.confirmProgress > 0 ? "hold still to set it" : "open or close your fingers";
    el.innerHTML = `${icon} ${Math.round(lvl.value * 100)} % <small>${hint}</small>`;
    el.style.setProperty("--p", String(lvl.confirmProgress));
  }

  function draw() {
    if (stopped) return;
    const t = performance.now();
    const w = (canvas.width = video.videoWidth || 640);
    const h = (canvas.height = video.videoHeight || 360);
    ctx.clearRect(0, 0, w, h);
    if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
    for (const hand of lastFrame?.hands ?? []) {
      // Several hands may be in view: the one being followed (the nearest) is drawn bright.
      ctx.globalAlpha = hand === interaction.activeHand ? 1 : 0.3;
      ctx.strokeStyle = "#ffffffb3";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(hand.points[a].x * w, hand.points[a].y * h);
        ctx.lineTo(hand.points[b].x * w, hand.points[b].y * h);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffd23f";
      for (const p of hand.points) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Mouse button: a ring on the index tip, yellow while the fingers touch, red while dragging.
    const hand = interaction.activeHand;
    const button = interaction.mouseButton;
    if (mouseOn() && hand && button !== "up") {
      const tip = hand.points[L.INDEX_TIP];
      ctx.strokeStyle = button === "dragging" ? "#ff5d5d" : "#ffd23f";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(tip.x * w, tip.y * h, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    const lvl = interaction.levelActive(t);
    if (lvl) {
      ctx.strokeStyle = `hsl(${Math.round(120 * lvl.value)}, 90%, 55%)`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(lvl.thumb.x * w, lvl.thumb.y * h);
      ctx.lineTo(lvl.index.x * w, lvl.index.y * h);
      ctx.stroke();
    }
    paintSleep(t);
    paintLevel(lvl);
    paintMenu();
    const needScreen =
      !!interaction.menuOpen(t) || interaction.levelArmed || !!lvl || (!!chosen && t - chosen.t < 700);
    if (needScreen !== screenNeeded) {
      screenNeeded = needScreen;
      options.onScreenOverlay?.(needScreen);
    }
    if (t - tAction > 1800) $("action").textContent = "";
    requestAnimationFrame(draw);
  }

  // ---------- Start ----------

  async function start() {
    try {
      const s = await helper.status();
      launchers = s.launchers ?? [];
      $("status").textContent = `${s.dryRun ? "Dry run — nothing is pressed · " : ""}${s.desktop}`;
      showPage({ id: "main" });
      paintGuide();
    } catch {
      $("status").textContent = options.unreachable ?? "Helper not reachable — start it with: go run ./adapters/desktop (port 8767)";
      $("status").classList.add("error");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      if (stopped) {
        for (const tr of stream.getTracks()) tr.stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      requestAnimationFrame(draw); // the image shows even if the hand tracker fails to load
      const tr = await createTracker(video, (f) => {
        lastFrame = f;
        interaction.process(f);
      });
      if (stopped) {
        tr.stop();
        return;
      }
      tracker = tr;
    } catch (e) {
      $("status").textContent = `Camera error: ${(e as Error).message}`;
      $("status").classList.add("error");
    }
  }

  showPage({ id: "main" });
  paintGuide();
  void start();

  return {
    stop() {
      stopped = true;
      tracker?.stop();
      const stream = video.srcObject as MediaStream | null;
      for (const t of stream?.getTracks() ?? []) t.stop();
      video.srcObject = null;
      root.classList.remove("gc", "compact", "screen");
      document.documentElement.classList.remove("gc-see-through");
      root.innerHTML = "";
    },
    setScreen(on: boolean) {
      root.classList.toggle("screen", on);
      document.documentElement.classList.toggle("gc-see-through", on);
    },
    setCompact(on: boolean) {
      root.classList.toggle("compact", on);
    },
  };
}
