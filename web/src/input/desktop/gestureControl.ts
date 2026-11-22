// Gesture Control camera page, mountable anywhere (its own window, or option 1 of the desktop app):
// recognizes hand gestures and sends the computer and video-call actions to
// the local helper (adapters/desktop), which performs them on the real computer.
//
// - The detector sleeps until a strict open palm (fingers straight and spread, facing the camera)
//   wakes it, and goes back to sleep after a while without gestures.
// - ✊ opens the quick menu: volume, brightness, microphone, apps and computer (power) options.
// - With "Move the mouse", ☝️ moves the cursor and touching the middle fingertip to the thumb clicks
//   (twice quickly: right click; holding: drag).
import { HALO } from "../overlay.ts";
import { actionFor, MAPS, type Action } from "../actions.ts";
import { areaPoint, HandInteraction, POINTER_AREA, type WakeIssue } from "../interaction.ts";
import { createTracker, type Tracker } from "../tracker.ts";
import { CONNECTIONS, L, type HandEvent, type HandFrame, type LevelTarget, type MenuSector, type MouseAction, type Point } from "../types.ts";
import { latestOnly, OS_ACTIONS, toScreen, type ActionOptions, type CallAppId, type HelperClient } from "./client.ts";
import { MARKUP } from "./markup.ts";
import "./gestureControl.css";
import { cellsOf, menuPage, micStateOf, powerLabel, type DesktopContext, type Launcher, type MenuPage } from "./menu.ts";
import { optionHtml } from "./menuView.ts";

export interface GestureControlOptions {
  /** Status text when the helper can't be reached. */
  unreachable?: string;
  /**
   * Called when the page starts or stops needing the whole screen: while the menu is open or the
   * volume/brightness is being adjusted (the desktop app then spreads its window over the screen).
   */
  onScreenOverlay?: (need: boolean) => void;
  /**
   * A swipe of the open hand ("left" is the user's left). Return true to take it (it then does
   * nothing else): the app uses it to control a reading in progress.
   */
  onSwipe?: (direction: "left" | "right") => boolean;
  /** "Close app" in the gesture menu: quit the app (the desktop app does it). */
  onQuit?: () => void;
  /** "Main menu": show the overlay's main menu again; the gestures keep working. */
  onMainMenu?: () => void;
  /** Three fingers: read the text selected in the program in front aloud (the app does it). */
  onReadSelection?: () => void;
  /** Called when cursor mode is turned on or off (the desktop app moves out of the way when on). */
  onCursorMode?: (on: boolean) => void;
  /** Where cursor mode moves the mouse ([0, 1] over the screen), e.g. to keep a window out of its way. */
  onPointer?: (screen: Point) => void;
}

export interface GestureControlHandle {
  /** Stops the camera and the tracker and empties the root. */
  stop(): void;
  /** Shows only the camera (the desktop app's corner bubble). */
  setCompact(on: boolean): void;
  /** Stops the camera (another part of the app needs it) with a reason shown over the view, or starts it again. */
  setCamera(on: boolean, reason?: string): void;
  /** Plays the camera again after the page was moved to another place in the document. */
  resume(): void;
  /** Wakes the gestures (when the person opens Gesture Control, they may be asleep). */
  wakeGestures(): void;
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
  // A gesture right click over this page must not open the browser's context menu.
  const noMenu = (e: Event) => e.preventDefault();
  root.addEventListener("contextmenu", noMenu);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  const video = $<HTMLVideoElement>("video");
  const canvas = $<HTMLCanvasElement>("canvas");
  const ctx = canvas.getContext("2d")!;

  const interaction = new HandInteraction({ requireWake: true, mouseClicks: false, menuArea: POINTER_AREA });
  let stopped = false;
  let screenNeeded = false;
  let powerOn = false;
  let tracker: Tracker | null = null;
  let tDrawn = -Infinity;
  const DRAW_MS = 1000 / 32;

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
    none: "Asleep. Hold up an open palm, fingers spread, to wake",
    open: "Open all five fingers",
    straight: "Straighten your fingers",
    spread: "Spread your fingers apart",
    facing: "Turn your palm towards the camera",
    upright: "Hold your hand upright",
  };
  const MOUSE_LABELS: Record<MouseAction, string> = {
    click: "Click",
    right_click: "Right click",
    down: "Holding — move to drag",
    up: "Released",
  };

  const enabled = () => $<HTMLInputElement>("enabled").checked;
  const mouseOn = () => $<HTMLInputElement>("mouse").checked;
  const app = () => $<HTMLSelectElement>("app").value as CallAppId;
  /** The system microphone, as the helper last said (null: not known yet). */
  let micMuted: boolean | null = null;
  /** Toggles still waiting for the helper: a state read meanwhile would be out of date. */
  let micBusy = 0;
  let tMicRead = -Infinity;
  /** Reads the real microphone state (on start and when the menu opens, at most every 2 s). */
  function refreshMic() {
    const t = performance.now();
    if (t - tMicRead < 2000) return;
    tMicRead = t;
    void helper.micMuted().then((muted) => {
      if (micBusy === 0 && muted !== null) micMuted = muted;
    });
  }
  const layout = () => menuPage(page, context, launchers, mouseOn(), powerOn, micMuted);

  /**
   * Cursor mode: ☝️ moves the mouse, the middle finger on the thumb clicks (twice: right click;
   * holding: drag) and the open palm moving up or down scrolls. Off, pointing does nothing.
   */
  let tPointerError = -Infinity;
  function pointerError(err: Error) {
    const t = performance.now();
    if (t - tPointerError < 5000) return;
    tPointerError = t;
    toast(`Mouse: ${err.message}`, true);
    log(`Mouse: ${err.message}`);
  }

  function setCursor(on: boolean) {
    $<HTMLInputElement>("mouse").checked = on;
    interaction.configure({ mouseClicks: on });
    toast(on ? "Cursor mode on" : "Cursor mode off");
    paintGuide();
    options.onCursorMode?.(on);
  }

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
      log(`${label(action)}: ${(e as Error).message}`);
      return null;
    }
  }

  // System calls for volume and brightness can be slower than the hand: only the newest value is sent.
  const lastLevel: Record<LevelTarget, number | null> = { volume: null, brightness: null };
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
    if (page.id === "confirm" || page.id === "confirm2") {
      showPage({ id: "computer" });
      reopening = true;
      try {
        interaction.reopenMenu(t);
      } finally {
        reopening = false;
      }
      toast("Back");
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
      toast("Back");
      return;
    }
    showPage({ id: "main" });
    interaction.closeMenu(t);
    toast("Closed");
  }

  function onMenu(e: Extract<HandEvent, { type: "menu" }>) {
    if (e.phase === "open") {
      if (!reopening) {
        showPage({ id: "main" });
        refreshMic();
      }
      return;
    }
    if (e.phase === "back") {
      goBack(e.t);
      return;
    }
    if (e.phase !== "choose" || !e.sector) return;
    const item = layout()[e.sector];
    if (!item) return;
    if (item.kind === "action" && item.action === "mic_mute") {
      toggleMic(e.t);
      return;
    }
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
        toast(`${item.target === "brightness" ? "Brightness" : "Volume"}: pinch, then open your fingers`);
        break;
      case "action":
        toast(label(item.action));
        void perform(item.action);
        break;
      case "power":
        toast(`${powerLabel(item.action)}…`);
        void perform(item.action, { confirm: true });
        break;
      case "app":
        if (item.id) {
          toast(`${item.label}`);
          void perform("open_app", { target: item.id });
        } else {
          toast("Empty slot: add apps to apps.json (see the README)", true);
        }
        break;
      case "close":
        toast("Cancelled");
        break;
      case "quit":
        toast("Closing the assistant");
        if (options.onQuit) options.onQuit();
        else toast("Close the window to quit", true);
        break;
      case "main_menu":
        if (options.onMainMenu) {
          toast("Main menu");
          options.onMainMenu();
        } else toast("No main menu here", true);
        break;
      case "cursor": {
        const was = mouseOn();
        setCursor(!was);
        rememberUndo("cursor mode", () => setCursor(was));
        break;
      }
    }
  }

  // ---------- Undo (thumb to the left) ----------

  /** The last action the thumb to the left can undo, for UNDO_MS. */
  let undo: { label: string; t: number; run: () => void } | null = null;
  const UNDO_MS = 15_000;
  /** Volume or brightness before the pinch, read when it is armed (null: unknown). */
  const levelBefore: Record<LevelTarget, number | null> = { volume: null, brightness: null };

  function rememberUndo(label: string, run: () => void) {
    undo = { label, t: performance.now(), run };
  }

  /** Thumb to the left outside the menu: undoes the last action (volume, brightness, mic, cursor). */
  function undoLast() {
    const u = undo;
    undo = null;
    if (!u || performance.now() - u.t > UNDO_MS) {
      toast("Nothing to undo");
      return;
    }
    toast(`Undone: ${u.label}`);
    log(`Undo: ${u.label}`);
    u.run();
  }

  /** The microphone is a toggle: the menu stays open and the option shows the new state. */
  function toggleMic(t: number) {
    reopening = true;
    try {
      interaction.reopenMenu(t);
    } finally {
      reopening = false;
    }
    if (!enabled()) return;
    flipMic(true);
  }

  /** Toggles the system microphone; `remember`: thumb to the left can undo it. */
  function flipMic(remember: boolean) {
    if (micMuted !== null) micMuted = !micMuted; // shown at once, corrected by the helper's answer
    micBusy++;
    void perform("mic_mute").then((did) => {
      micBusy--;
      if (!did) {
        // It failed (perform showed why): read the real state instead of the guess.
        tMicRead = -Infinity;
        refreshMic();
        return;
      }
      // The helper says "microphone muted", "microphone on" or, if it cannot tell, "microphone toggled".
      const state = micStateOf(did);
      if (state !== null) micMuted = state;
      if (remember) rememberUndo("microphone", () => flipMic(false));
      // Muted, the voice commands do not hear anything either: say so.
      toast(micMuted === null ? did : micMuted ? "Microphone muted · voice commands will not hear you" : "Microphone on");
    });
  }

  // ---------- Gestures → actions ----------

  interaction.on((e) => {
    if (e.type === "mode") {
      toast(e.awake ? "Gestures on" : "Gestures asleep");
      return;
    }
    if (e.type === "menu") {
      onMenu(e);
      return;
    }
    if (!enabled()) return;

    if (e.type === "pointer") {
      // A failing mouse (a missing tool on Linux, for example) must not fail silently.
      if (mouseOn()) {
        const screenPoint = toScreen(e.image);
        void helper.pointer(screenPoint).catch((err: Error) => pointerError(err));
        options.onPointer?.(screenPoint);
      }
      return;
    }
    if (e.type === "scroll") {
      if (mouseOn()) helper.mouse(e.direction === "up" ? "scroll_up" : "scroll_down").catch((err: Error) => toast(`Scroll: ${err.message}`, true));
      return;
    }
    if (e.type === "mouse") {
      if (!mouseOn()) return;
      toast(MOUSE_LABELS[e.action]);
      helper.mouse(e.action).catch((err: Error) => toast(`Mouse: ${err.message}`, true));
      return;
    }

    if (e.type === "gesture" && e.gesture === "thumbs_left") {
      undoLast();
      return;
    }
    if (e.type === "level" && e.phase === "armed") {
      // Read the value now, so that undo can put it back exactly.
      const target = e.target;
      levelBefore[target] = null;
      void helper.level(target).then((v) => (levelBefore[target] = v));
    }
    if (e.type === "level" && e.phase === "end") {
      const target = e.target;
      const before = levelBefore[target];
      levelBefore[target] = null;
      if (before !== null) {
        const name = target === "brightness" ? "Brightness" : "Volume";
        rememberUndo(`${name.toLowerCase()} back to ${Math.round(before * 100)} %`, () => {
          lastLevel[target] = null;
          sendLevel[target](before);
        });
      }
    }

    if (e.type === "swipe" && options.onSwipe?.(e.direction)) return;
    const action = actionFor(e, context);
    if (!action) return;
    if (action === "read_selection") {
      toast("Reading the selected text");
      if (options.onReadSelection) options.onReadSelection();
      else toast("Reading the selection only works in the desktop app", true);
      return;
    }
    if (e.type === "level") {
      toast(`${e.target === "brightness" ? "Brightness" : "Volume"} ${Math.round(e.value * 100)} %`);
      // The system value follows the hand at most 20 % per update; the confirmed value is exact.
      const last = lastLevel[e.target];
      const v = e.phase === "end" || last === null ? e.value : last + Math.max(-0.2, Math.min(0.2, e.value - last));
      lastLevel[e.target] = e.phase === "end" ? null : v;
      sendLevel[e.target](v);
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

  $("mouse").addEventListener("change", () => setCursor(mouseOn()));

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
    const menu = Object.values(menuPage({ id: "main" }, context, launchers, false, powerOn))
      .map((i) => i!.label.replace(/^\S+\s/, "").replace(" ▸", ""))
      .join(", ");
    const rows: [string, string | null][] = [
      ["Open palm, fingers spread (hold ~1 s)", "Wake up"],
      ["Three fingers up (index, middle, ring)", "Read the selected text aloud"],
      ["Thumbs up", m.thumbs_up && label(m.thumbs_up)],
      ["Thumbs down", m.thumbs_down && label(m.thumbs_down)],
      ["/ Swipe", m.swipe_right && m.swipe_left ? "Next / previous tab" : null],
      ["Fist (hold) → point + tap middle finger on thumb", `Menu: ${menu}`],
      ["again, inside the menu", "Close the menu"],
      ["Thumb to the left / Swipe, in menu", "Go back / close"],
      ["Thumb to the left", "Undo the last action (volume, brightness, mic, cursor)"],
      ["Cursor mode (menu, or the switch below)", mouseOn() ? "On" : "Off"],
      ["Point (cursor mode)", "Move the mouse"],
      ["+ middle fingertip on the thumb (cursor mode)", "Click · twice quickly: right click · hold: drag"],
      ["Open palm up / down (cursor mode)", "Scroll"],
      ["Keyboard (menu ▸ Apps)", "On-screen keyboard, to type with the mouse"],
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
      // Icon, name and state (menuView.ts); rebuilt only when the option changes (this runs every frame).
      if (op.dataset.label !== (text ?? "")) {
        op.dataset.label = text ?? "";
        op.innerHTML = text ? optionHtml(open ? options[s] : undefined, text) : "";
      }
      op.classList.toggle("active", open?.sector === s);
      op.classList.toggle("chosen", shownChoice?.sector === s);
      op.classList.toggle("danger", !!text && options[s]?.kind === "quit");
      op.style.setProperty("--p", open?.sector === s ? String(open.progress) : "0");
    }
    const titles: Record<MenuPage["id"], string> = { main: "Menu", computer: "Computer", apps: "Apps", confirm: "Are you sure?", confirm2: "Really?" };
    $("menuTitle").textContent =
      page.id === "confirm" ? `${powerLabel(page.action)}?` : page.id === "confirm2" ? `Really ${powerLabel(page.action).toLowerCase()}?` : titles[page.id];
    const p = interaction.pointer;
    const cursor = $("cursor");
    cursor.hidden = !(open && p);
    if (open && p) {
      // Same mapping as the menu cells: the dot is where the option is chosen.
      const q = areaPoint(p);
      cursor.style.left = `${q.x * 100}%`;
      cursor.style.top = `${q.y * 100}%`;
    }
  }

  function paintSleep(t: number) {
    const asleep = !interaction.isAwake;
    $("stage").classList.toggle("asleep", asleep);
    const el = $("sleep");
    el.hidden = !asleep;
    if (!asleep) return;
    const progress = interaction.wakeProgress(t);
    el.textContent = progress > 0 ? "Hold still…" : WAKE_HINTS[interaction.wakeHint ?? "none"];
    el.style.setProperty("--p", String(progress));
  }

  /** Rewriting the same text every frame still costs layout work: only when it changes. */
  function setHtml(el: HTMLElement, html: string) {
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  }

  /** Volume or brightness being adjusted: the value, and how long until it is set. */
  function paintLevel(lvl: ReturnType<HandInteraction["levelActive"]>) {
    const el = $("level");
    el.hidden = !lvl && !interaction.levelArmed;
    if (el.hidden) return;
    const brightness = interaction.levelTargetName === "brightness";
    const icon = brightness ? "Brightness" : "Volume";
    if (!lvl) {
      setHtml(el, `${icon} <small>touch thumb and index, then open them</small>`);
      el.style.setProperty("--p", "0");
      return;
    }
    const hint = lvl.confirmProgress > 0 ? "hold still to set it" : "open or close your fingers";
    setHtml(el, `${icon} ${Math.round(lvl.value * 100)} % <small>${hint}</small>`);
    el.style.setProperty("--p", String(lvl.confirmProgress));
  }

  function draw() {
    if (stopped) return;
    const t = performance.now();
    // At most as often as the camera gives images: the screen may refresh 60–144 times a second.
    if (t - tDrawn < DRAW_MS) {
      requestAnimationFrame(draw);
      return;
    }
    tDrawn = t;
    // Setting a canvas's size reallocates and clears it: only when the camera's size changes.
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
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
      ctx.fillStyle = HALO.mark;
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
      ctx.strokeStyle = button === "dragging" ? HALO.bad : HALO.mark;
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

  let statusText = "";

  /**
   * Speed in the status line, every second: images analysed per second, where the detector runs
   * and how long each analysis takes. On the CPU it is several times slower: say so.
   */
  function showSpeed(base: string) {
    const id = setInterval(() => {
      if (stopped || !tracker) return clearInterval(id);
      const tr = tracker;
      const speed = `${Math.round(tr.fps)} fps · ${tr.delegate ?? "?"} · ${Math.round(tr.analysisMs)} ms`;
      const el = $("status");
      el.textContent = `${statusText || base} · ${speed}`;
      el.classList.toggle("error", tr.delegate === "CPU" || (tr.fps > 0 && tr.fps < 15));
    }, 1000);
  }

  async function start() {
    try {
      const s = await helper.status();
      launchers = s.launchers ?? [];
      powerOn = s.power === true;
      statusText = `${s.dryRun ? "Dry run — nothing is pressed · " : ""}${s.desktop}`;
      $("status").textContent = statusText;
      $("dryrun").hidden = !s.dryRun;
      showPage({ id: "main" });
      paintGuide();
    } catch {
      $("status").textContent = options.unreachable ?? "Helper not reachable — start it with: go run ./adapters/desktop (port 8767)";
      $("status").classList.add("error");
    }
    refreshMic();
    await startCamera();
  }

  /** Each start or pause of the camera; a start that finds a newer one gives the camera back. */
  let cameraRun = 0;
  let drawing = false;

  async function startCamera(attempt = 0) {
    const run = ++cameraRun;
    const stale = () => stopped || run !== cameraRun;
    showCameraMessage(null);
    try {
      // 640×360 is plenty: MediaPipe shrinks every image to ~200 px to find the hand, and a smaller
      // image is cheaper to copy to it and to draw.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (stale()) {
        for (const tr of stream.getTracks()) tr.stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (!drawing) {
        drawing = true;
        requestAnimationFrame(draw); // the image shows even if the hand tracker fails to load
      }
      // One hand: with two, MediaPipe looks for the second one in every frame while only one is
      // in view, which costs as much as tracking it.
      let tr: Tracker;
      try {
        tr = await createTracker(
          video,
          (f) => {
            lastFrame = f;
            interaction.process(f);
          },
          { numHands: 1 },
        );
      } catch (e) {
        // The camera works but the hand detector didn't load (MediaPipe comes from the internet).
        if (stale()) return;
        const text = `Hand detection could not start: ${(e as Error)?.message ?? e}`;
        showCameraMessage(text, true);
        $("status").textContent = text;
        $("status").classList.add("error");
        return;
      }
      if (stale()) {
        tr.stop();
        return;
      }
      tracker = tr;
      showSpeed(statusText);
    } catch (e) {
      if (stale()) return;
      // Coming back from another option, its camera may take a moment to be released: try again.
      if ((e as { name?: string })?.name === "NotReadableError" && attempt < 4) {
        showCameraMessage("Waiting for the camera…");
        setTimeout(() => {
          if (!stale()) void startCamera(attempt + 1);
        }, 700);
        return;
      }
      const text = cameraErrorText(e);
      showCameraMessage(text);
      $("status").textContent = `Camera: ${text}`;
      $("status").classList.add("error");
    }
  }

  /** Gives the camera back (another part of the app needs it) and shows why it is off. */
  function stopCamera(reason: string) {
    cameraRun++;
    tracker?.stop();
    tracker = null;
    lastFrame = null;
    const stream = video.srcObject as MediaStream | null;
    for (const t of stream?.getTracks() ?? []) t.stop();
    video.srcObject = null;
    showCameraMessage(reason);
  }

  /** A message over the camera view (no camera, camera in use…); null hides it. */
  function showCameraMessage(text: string | null, soft = false) {
    const el = $("nocam");
    el.hidden = text === null;
    el.textContent = text ?? "";
    el.classList.toggle("soft", soft);
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
      root.removeEventListener("contextmenu", noMenu);
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
    setCamera(on: boolean, reason = "Camera paused: another option is using it") {
      if (stopped) return;
      if (on) void startCamera();
      else stopCamera(reason);
    },
    wakeGestures() {
      interaction.wakeNow();
    },
    resume() {
      // Moving the page in the document can pause the video: play it again.
      if (video.srcObject) void video.play().catch(() => {});
    },
  };
}

/** A camera error in words for the user. */
export function cameraErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera blocked: allow camera access for this app";
  if (name === "NotReadableError" || name === "AbortError") return "Camera in use by another program";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found";
  return `Camera error: ${(e as Error)?.message ?? String(e)}`;
}
