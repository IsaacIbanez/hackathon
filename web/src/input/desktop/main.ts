// Gesture Control page: recognizes hand gestures and sends the computer and video-call actions to
// the local helper (adapters/desktop), which performs them on the real computer.
import { actionFor, MAPS, menuFor, type Action, type Context } from "../actions.ts";
import { HandInteraction } from "../interaction.ts";
import { createTracker } from "../tracker.ts";
import { CONNECTIONS, type HandFrame, type MenuSector } from "../types.ts";
import { HelperClient, OS_ACTIONS, toScreen, type CallAppId } from "./client.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;

const token = document.querySelector<HTMLMetaElement>('meta[name="gesture-token"]')?.content ?? "";
const helper = new HelperClient(token);
const interaction = new HandInteraction();

type DesktopContext = Extract<Context, "pc" | "call">;
let context: DesktopContext = "call";
let lastFrame: HandFrame | null = null;
let tAction = 0;
let chosen: { sector: MenuSector; t: number } | null = null;

const LABELS: Partial<Record<Action, string>> = {
  enter: "Enter", escape: "Escape", next_tab: "Next tab", previous_tab: "Previous tab", undo: "Undo",
  click: "Click", volume: "Volume", toggle_mic: "Mute / unmute", toggle_camera: "Camera on / off",
  raise_hand: "Raise hand", leave_call: "Leave call", adjust_volume: "Adjust volume",
  ask_for_help: "Ask for help", repeat: "Repeat", dictate: "Dictate",
};
const label = (a: Action) => LABELS[a] ?? a.replaceAll("_", " ");
const ARROWS: Record<MenuSector, string> = { up: "↑", right: "→", down: "↓", left: "←" };

const enabled = () => $<HTMLInputElement>("enabled").checked;
const mouseOn = () => $<HTMLInputElement>("mouse").checked;
const app = () => $<HTMLSelectElement>("app").value as CallAppId;

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
async function perform(action: Action, value?: number) {
  const options = { ...(value === undefined ? {} : { value }), ...(context === "call" ? { app: app() } : {}) };
  try {
    const did = await helper.action(action, options);
    log(did);
  } catch (e) {
    toast(`${label(action)}: ${(e as Error).message}`, true);
    log(`✗ ${label(action)}: ${(e as Error).message}`);
  }
}

// ---------- Gestures → actions ----------

interaction.on((e) => {
  if (!enabled()) return;

  if (e.type === "pointer" && mouseOn()) {
    void helper.pointer(toScreen(e.image)).catch(() => {});
    return;
  }
  if (e.type === "menu" && e.phase === "choose" && e.sector) chosen = { sector: e.sector, t: performance.now() };

  const action = actionFor(e, context);
  if (!action) return;

  if (action === "adjust_volume") {
    interaction.startLevel();
    toast("🤏 Pinch, then open your fingers");
    return;
  }
  if (action === "volume" && e.type === "level") {
    toast(`🔊 ${Math.round(e.value * 100)} %`);
    void perform("volume", e.value);
    return;
  }
  // A dwell "click" only makes sense when the pointer is also moving the real mouse.
  if (action === "click" && !mouseOn()) return;
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

for (const b of document.querySelectorAll<HTMLButtonElement>("#context button")) {
  b.addEventListener("click", () => {
    context = b.dataset.c as DesktopContext;
    for (const o of document.querySelectorAll<HTMLButtonElement>("#context button")) {
      o.setAttribute("aria-pressed", String(o === b));
    }
    $("app").hidden = context !== "call";
    paintGuide();
  });
}

function paintGuide() {
  const m = MAPS[context];
  $("contextName").textContent = context === "call" ? "Video call" : "Computer";
  const rows: [string, Action | null][] = [
    ["✋ Open palm facing the camera", m.palm],
    ["👍 Thumbs up", m.thumbs_up],
    ["👎 Thumbs down", m.thumbs_down],
    ["✋→ / ✋← Swipe", m.swipe_right && m.swipe_left ? m.swipe_right : null],
    ["☝️ Point (with “Move the mouse”)", "click"],
    ...(Object.entries(menuFor(interaction.handInUse, context)) as [MenuSector, Action][]).map(
      ([s, a]) => [`✌️ Menu ${ARROWS[s]}`, a] as [string, Action],
    ),
  ];
  $("guide").innerHTML = rows
    .map(([g, a]) => `<tr><td>${g}</td><td>${a ? (g.startsWith("✋→") ? "Next / previous tab" : label(a)) : "—"}</td></tr>`)
    .join("");
}

// ---------- Drawing ----------

function paintMenu() {
  const t = performance.now();
  const open = interaction.menuOpen(t);
  const shownChoice = chosen && t - chosen.t < 700 ? chosen : null;
  $("menu").hidden = !open && !shownChoice;
  const options = menuFor(open?.hand ?? interaction.handInUse, context);
  for (const op of document.querySelectorAll<HTMLElement>("#menu .op")) {
    const s = op.dataset.s as MenuSector;
    const a = options[s];
    op.style.visibility = a ? "visible" : "hidden";
    op.textContent = a ? `${ARROWS[s]} ${label(a)}` : "";
    op.classList.toggle("active", open?.sector === s);
    op.classList.toggle("chosen", shownChoice?.sector === s);
    op.style.setProperty("--p", open?.sector === s ? String(open.progress) : "0");
  }
  const p = interaction.pointer;
  const cursor = $("cursor");
  cursor.hidden = !(open && p);
  if (open && p) {
    cursor.style.left = `${(1 - p.x) * 100}%`;
    cursor.style.top = `${p.y * 100}%`;
  }
}

function draw() {
  const w = (canvas.width = video.videoWidth || 640);
  const h = (canvas.height = video.videoHeight || 360);
  ctx.clearRect(0, 0, w, h);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
  for (const hand of lastFrame?.hands ?? []) {
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
  const lvl = interaction.levelActive(performance.now());
  if (lvl) {
    ctx.strokeStyle = `hsl(${Math.round(120 * lvl.value)}, 90%, 55%)`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(lvl.thumb.x * w, lvl.thumb.y * h);
    ctx.lineTo(lvl.index.x * w, lvl.index.y * h);
    ctx.stroke();
  }
  paintMenu();
  if (performance.now() - tAction > 1800) $("action").textContent = "";
  requestAnimationFrame(draw);
}

// ---------- Start ----------

async function start() {
  try {
    const s = await helper.status();
    $("status").textContent = `${s.dryRun ? "Dry run — nothing is pressed · " : ""}${s.desktop}`;
  } catch {
    $("status").textContent = "Helper not reachable — start it with: go run ./adapters/desktop";
    $("status").classList.add("error");
  }
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    await video.play();
    const tracker = await createTracker(video, (f) => {
      lastFrame = f;
      interaction.process(f);
    });
    void tracker;
    requestAnimationFrame(draw);
  } catch (e) {
    $("status").textContent = `Camera error: ${(e as Error).message}`;
    $("status").classList.add("error");
  }
}

paintGuide();
start();
