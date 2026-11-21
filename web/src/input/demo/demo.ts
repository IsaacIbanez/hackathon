// Test page for the hand module. Start it with:  npx vite web/src/input  → /demo/
import {
  actionFor,
  CONNECTIONS,
  createTracker,
  DEFAULT_OPTIONS,
  HandInteraction,
  MAPS,
  menuFor,
  REDUCED_MOBILITY_PROFILE,
  type Context,
  type Corners,
  type HandEvent,
  type HandFrame,
  type HandSide,
  type MenuSector,
  type Point,
  type Tracker,
} from "../index.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const checkbox = (id: string) => $<HTMLInputElement>(id);

const interaction = new HandInteraction();
let tracker: Tracker | null = null;
let lastFrame: HandFrame | null = null;
let corners: Point[] | null = null;
let marking: Point[] | null = null;
let context: Context = "document";
let tAction = 0;
let volume = 1;
let chosenMenu: { sector: MenuSector; center: Point; hand: HandSide | null; t: number } | null = null;
let shownHand: HandSide | null | undefined;

// ---------- UI labels ----------

const ACTION_LABELS: Record<string, string> = {
  read: "Read", pause: "Pause", next: "Next", previous: "Previous", explain_here: "Explain this",
  confirm_field: "Confirm field", next_field: "Next field", previous_field: "Previous field",
  dictate_field: "Dictate field", clear_field: "Clear field", enter: "Enter", escape: "Escape",
  next_tab: "Next tab", previous_tab: "Previous tab", click: "Click", undo: "Undo",
  volume: "Volume", wake: "Awake", sleep: "Asleep", adjust_volume: "Adjust volume",
  toggle_mic: "Mute / unmute", toggle_camera: "Camera on / off", raise_hand: "Raise hand", leave_call: "Leave call",
  repeat: "Repeat", copy_text: "Copy text", dictate: "Dictate", ask_for_help: "Ask for help",
};
const GESTURE_LABELS: Record<string, string> = {
  none: "—", point: "Pointing", palm: "Open palm", fist: "Fist", thumbs_up: "Thumbs up",
  thumbs_down: "Thumbs down", victory: "Victory", pinch: "Pinch",
};
const CONTEXT_LABELS: Record<Context, string> = { document: "Reading", form: "Form", pc: "Computer", call: "Video call" };
const HAND_LABELS: Record<HandSide, string> = { right: "Right", left: "Left" };
const PHASE_LABELS: Record<string, string> = {
  open: "open", highlight: "highlight", choose: "chosen", close: "closed",
  armed: "armed", start: "start", move: "move", end: "set", cancel: "cancelled",
};
const EVENT_LABELS: Record<string, string> = {
  gesture: "Gesture", swipe: "Swipe", menu: "Menu", level: "Volume", head: "Head", mode: "Mode",
  hand: "Hand", select: "Select", pointer: "Pointer",
};
const ARROWS: Record<MenuSector, string> = { up: "↑", right: "→", down: "↓", left: "←" };

/** Human-readable label for an action (or any other text). */
const label = (s: string) => ACTION_LABELS[s] ?? s.replaceAll("_", " ");
const gestureLabel = (g: string) => GESTURE_LABELS[g] ?? g;

// ---------- Events ----------

interaction.on((e) => {
  if (e.type === "pointer") {
    $("docPointer").textContent = e.document ? `${e.document.x.toFixed(2)}, ${e.document.y.toFixed(2)}` : "outside";
    return;
  }
  if (e.type === "level" && (e.phase === "start" || e.phase === "move" || e.phase === "end")) {
    // The pinch sets the demo's voice volume (a real effect, not just an event).
    volume = e.value;
    $("volume").textContent = `${Math.round(volume * 100)} %`;
    $("volumeMeter").style.width = `${Math.round(volume * 100)}%`;
    if (e.phase !== "end") return; // don't flood the log with every movement
  }
  const action = actionFor(e, context);
  logEvent(e, action);
  if (e.type === "gesture") $("gesture").textContent = gestureLabel(e.gesture);
  if (e.type === "menu" && e.phase === "choose" && e.sector) {
    chosenMenu = { sector: e.sector, center: e.center, hand: e.hand, t: performance.now() };
  }
  if (e.type === "mode") paintMode();
  if (action === "volume" && e.type === "level") showAction(action, `Volume ${Math.round(e.value * 100)} %`);
  else if (action) showAction(action);
  // Choosing "adjust volume" in the menu arms the control: then the user pinches.
  if (action === "adjust_volume") interaction.startLevel();
  if (e.type === "level" && e.phase === "cancel") showAction("Volume cancelled");
  if (e.type === "select" && checkbox("pointAsk").checked) listenForQuestion(e.document ?? e.image);
});

function logEvent(e: HandEvent, action: string | null) {
  const detail =
    e.type === "gesture" ? gestureLabel(e.gesture)
    : e.type === "swipe" ? e.direction
    : e.type === "menu" ? `${PHASE_LABELS[e.phase]}${e.sector ? ` ${e.sector}` : ""}`
    : e.type === "level" ? `${PHASE_LABELS[e.phase]} ${Math.round(e.value * 100)} %`
    : e.type === "head" ? e.gesture
    : e.type === "mode" ? (e.awake ? "awake" : "asleep")
    : e.type === "hand" ? (e.present ? "appears" : "lost")
    : "";
  const li = document.createElement("li");
  li.textContent = `${(e.t / 1000).toFixed(1)} s · ${EVENT_LABELS[e.type] ?? e.type} ${detail}${action ? ` → ${label(action)}` : ""}`;
  $("log").prepend(li);
  while ($("log").childElementCount > 80) $("log").lastElementChild!.remove();
}

function showAction(action: string, spoken = label(action)) {
  $("action").textContent = spoken;
  tAction = performance.now();
  if (checkbox("speak").checked) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = "en-US";
    u.volume = volume;
    speechSynthesis.speak(u);
  }
}

function paintMode() {
  const m = $("mode");
  m.hidden = !interaction.options.requireWake;
  m.className = `chip ${interaction.isAwake ? "awake" : "asleep"}`;
  m.textContent = interaction.isAwake ? "● Awake" : "● Asleep — hold an open palm";
}

// ---------- Controls ----------

for (const b of document.querySelectorAll<HTMLButtonElement>("#context button")) {
  b.addEventListener("click", () => {
    context = b.dataset.c as Context;
    for (const o of document.querySelectorAll<HTMLButtonElement>("#context button")) {
      o.setAttribute("aria-pressed", String(o === b));
    }
    paintGuide();
  });
}

checkbox("wake").addEventListener("change", (ev) => {
  interaction.configure({ requireWake: (ev.target as HTMLInputElement).checked });
  paintMode();
});

checkbox("mobility").addEventListener("change", (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  const defaults: Record<string, unknown> = {};
  for (const k of Object.keys(REDUCED_MOBILITY_PROFILE)) {
    defaults[k] = DEFAULT_OPTIONS[k as keyof typeof DEFAULT_OPTIONS];
  }
  interaction.configure(on ? REDUCED_MOBILITY_PROFILE : defaults);
});

checkbox("head").addEventListener("change", async (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  $("status").textContent = on ? "Loading the face model…" : "Head gestures off.";
  await tracker?.enableFace(on);
  if (on) $("status").textContent = "Head gestures on: nod or shake your head.";
});

// Point + ask: the browser's speech recognition (Chrome and Edge; Firefox doesn't have it).
type Recognizer = {
  lang: string;
  interimResults: boolean;
  onresult: (e: any) => void;
  onerror: (e: any) => void;
  onend: () => void;
  start(): void;
};
const RecognizerClass: (new () => Recognizer) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
if (!RecognizerClass) {
  checkbox("pointAsk").disabled = true;
  $("pointAskInfo").textContent = "Not available in this browser (try Chrome or Edge)";
}

function listenForQuestion(where: Point) {
  if (!RecognizerClass) return;
  const r = new RecognizerClass();
  r.lang = "en-US";
  r.interimResults = false;
  $("status").textContent = "🎤 Listening to your question…";
  r.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const li = document.createElement("li");
    li.textContent = `🎤 “${text}” at (${where.x.toFixed(2)}, ${where.y.toFixed(2)})`;
    $("log").prepend(li);
    showAction(`Question: ${text}`);
  };
  r.onerror = (e) => ($("status").textContent = `Voice: ${e.error}`);
  r.onend = () => ($("status").textContent = "Ready.");
  r.start();
}

function paintGuide() {
  const m = MAPS[context];
  $("contextName").textContent = CONTEXT_LABELS[context];
  const rows: [string, string | null, boolean][] = [
    ["👍 Thumbs up (hold)", m.thumbs_up, false],
    ["✋ Open palm facing the camera (hold still)", m.palm, false],
    ["✋→ Swipe to your right", m.swipe_right, false],
    ["✋← Swipe to your left", m.swipe_left, false],
    ["☝️ Point", "Move the pointer", false],
    ["☝️ Point and hold still ~1 s", m.select, false],
    ["👎 Thumbs down", m.thumbs_down, true],
    ["✌️ Victory", "Open the quick menu, then move the pointer onto an option and hold ~0.5 s", true],
    ...(Object.entries(menuFor(interaction.handInUse, context)) as [MenuSector, string][]).map(
      ([s, a]) => [`      Menu ${ARROWS[s]} ${s}`, a, true] as [string, string, boolean],
    ),
    ["🤏 After “Adjust volume”: pinch, then open", "Volume in 10 % steps; hold still ~1 s to set it", true],
    ["🙂 Nod", m.head.nod, true],
    ["🙂 Shake your head", m.head.shake, true],
  ];
  $("guide").innerHTML = rows
    .map(([g, a, beta]) => `<tr><td>${g}${beta ? '<i class="badge">BETA</i>' : ""}</td><td>${a ? label(a) : "—"}</td></tr>`)
    .join("");
}
paintGuide();

// ---------- Mark document ----------

$("markDocument").addEventListener("click", () => {
  marking = [];
  corners = null;
  interaction.setDocument(null);
  $("status").textContent = "Click the document corners: top-left, top-right, bottom-right, bottom-left (as you see them).";
});

canvas.addEventListener("click", (ev) => {
  if (!marking) return;
  const r = canvas.getBoundingClientRect();
  // The canvas is shown mirrored: undo the mirror to get image coordinates.
  marking.push({ x: 1 - (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
  if (marking.length === 4) {
    // The user clicks on the mirrored view: their top-left is the image's top-right.
    const [a, b, c, d] = marking;
    corners = [b, a, d, c];
    interaction.setDocument(corners as Corners);
    marking = null;
    $("status").textContent = "Document marked. Point inside it.";
  }
});

// ---------- Drawing ----------

/** Readable text on the mirrored canvas. */
function text(s: string, x: number, y: number, size = 28, color = "#fff") {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#000";
  ctx.strokeText(s, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** Menu as an HTML layer: shows the option under the pointer and the progress until it's chosen. */
function paintMenu() {
  const t = performance.now();
  const open = interaction.menuOpen(t);
  const chosen = chosenMenu && t - chosenMenu.t < 700 ? chosenMenu : null;
  $("menu").hidden = !open && !chosen;
  const options = menuFor(open?.hand ?? chosen?.hand ?? null, context);
  for (const op of document.querySelectorAll<HTMLElement>("#menu .op")) {
    const s = op.dataset.s as MenuSector;
    const action = options[s];
    // The side of the hand in use has no option (pointing outwards is awkward).
    op.style.visibility = action ? "visible" : "hidden";
    op.textContent = action ? `${ARROWS[s]} ${label(action)}` : "";
    const active = open?.sector === s;
    op.classList.toggle("active", active);
    op.classList.toggle("chosen", chosen?.sector === s);
    op.style.setProperty("--p", active ? String(open!.progress) : "0");
  }
}

/** Line between thumb and index: always thin (to see what the app measures), thick while adjusting. */
function drawPinch(w: number, h: number) {
  const d = interaction.diagnostics;
  if (!d) return;
  const n = interaction.levelActive(performance.now());
  const [ax, ay, bx, by] = [d.thumb.x * w, d.thumb.y * h, d.index.x * w, d.index.y * h];
  const o = interaction.options;
  // The pinch hint only shows when the volume is armed from the menu; otherwise it does nothing.
  const together = interaction.levelArmed && d.separation <= o.levelZero && d.reach >= o.thresholds.indexOut;
  ctx.strokeStyle = n ? `hsl(${Math.round(120 * n.value)}, 90%, 55%)` : together ? "#4cc9f0" : "#ffffff99";
  ctx.lineWidth = n ? 8 : 3;
  ctx.lineCap = "round";
  ctx.setLineDash(n ? [] : [10, 8]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    ctx.fillStyle = n ? "#fff" : "#ffffffaa";
    ctx.beginPath();
    ctx.arc(x, y, n ? 9 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const mx = (ax + bx) / 2;
  const my = Math.min(ay, by) - 30;
  // The line's measure, always visible next to it.
  text(d.separation.toFixed(2), mx + 40, (ay + by) / 2, 20, "#fff");
  if (n) {
    text(`🔊 ${Math.round(n.value * 100)} %`, mx, my - 10, 40, "#ffd23f");
    // Confirmation ring: fills up while you hold still on the same value.
    if (n.confirmProgress > 0) {
      ctx.strokeStyle = "#3ddc97";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(mx, my + 30, 18, -Math.PI / 2, -Math.PI / 2 + n.confirmProgress * Math.PI * 2);
      ctx.stroke();
    }
    // 10 % step bar on the image's right edge (the user's left, since they see a mirror).
    const barHeight = h * 0.7;
    const y0 = (h - barHeight) / 2;
    const xb = w - 70;
    const step = barHeight / 10;
    for (let i = 0; i < 10; i++) {
      const filled = (i + 1) / 10 <= n.value + 1e-6;
      ctx.fillStyle = filled ? `hsl(${Math.round(12 * (i + 1))}, 90%, 55%)` : "#000a";
      ctx.fillRect(xb, y0 + barHeight - (i + 1) * step + 2, 44, step - 4);
    }
    // Thin mark with the fingers' real (unrounded) position.
    ctx.fillStyle = "#fff";
    ctx.fillRect(xb - 10, y0 + barHeight * (1 - n.continuous) - 2, 64, 4);
  } else if (together) {
    text("🤏 Pinched — now open your fingers", mx, my, 22, "#4cc9f0");
  }
}

function draw() {
  const w = (canvas.width = video.videoWidth || 640);
  const h = (canvas.height = video.videoHeight || 480);
  ctx.clearRect(0, 0, w, h);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
  if (!interaction.isAwake) {
    ctx.fillStyle = "#0008";
    ctx.fillRect(0, 0, w, h);
  }

  const quad = corners ?? marking;
  if (quad?.length) {
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    if (corners) ctx.closePath();
    ctx.stroke();
  }

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
    for (const [i, p] of hand.points.entries()) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.fillStyle = tip ? "#ffd23f" : "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, tip ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wake progress ring, around the wrist.
    const progress = interaction.wakeProgress(performance.now());
    if (progress > 0) {
      const wrist = hand.points[0];
      ctx.strokeStyle = "#3ddc97";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(wrist.x * w, wrist.y * h, 40, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
  }

  const face = lastFrame?.face;
  if (face) {
    ctx.fillStyle = "#4cc9f088";
    for (let i = 0; i < face.points.length; i += 6) {
      ctx.fillRect(face.points[i].x * w - 1, face.points[i].y * h - 1, 2, 2);
    }
  }

  const p = interaction.pointer;
  if (p) {
    ctx.fillStyle = "#ff5d5d";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPinch(w, h);
  if (interaction.levelArmed) text("🤏 Pinch your thumb and index finger to start", w / 2, h * 0.14, 34, "#4cc9f0");
  paintMenu();
  const d = interaction.diagnostics;
  const scale = interaction.levelScale;
  $("separation").textContent = d
    ? `${d.separation.toFixed(2)}  (0 % ≤ ${scale.zero.toFixed(2)} · 100 % ≥ ${scale.full.toFixed(2)})`
    : "—";
  $("reach").textContent = d ? `${d.reach.toFixed(2)}  (start ≥ ${interaction.options.thresholds.indexOut.toFixed(2)})` : "—";
  // Pointer on top of the menu (the menu layer covers the canvas). The canvas is mirrored.
  const cursor = $("cursor");
  cursor.hidden = !(interaction.menuOpen(performance.now()) && p);
  if (!cursor.hidden && p) {
    cursor.style.left = `${(1 - p.x) * 100}%`;
    cursor.style.top = `${p.y * 100}%`;
  }
  if (interaction.handInUse !== shownHand) {
    shownHand = interaction.handInUse;
    const name = shownHand ? HAND_LABELS[shownHand] : "detecting…";
    $("handInUse").textContent = name;
    $("handChip").textContent = `Hand: ${name}`;
    paintGuide(); // the menu depends on the hand
  }

  if (performance.now() - tAction > 1500) $("action").textContent = "";
  $("pose").textContent = gestureLabel(interaction.pose);
  requestAnimationFrame(draw);
}

// ---------- Camera ----------

/** Opens the camera and watches for it dropping, to reconnect automatically. */
async function openCamera(): Promise<void> {
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  video.srcObject = stream;
  await video.play();
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    $("status").textContent = "The camera stopped. Reconnecting…";
    void reconnect();
  });
}

async function reconnect(attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await openCamera();
      await tracker?.restart();
      $("status").textContent = "Camera reconnected.";
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  $("status").textContent = "Couldn’t reconnect the camera. Press “Restart camera”.";
}

$("restartCamera").addEventListener("click", () => void reconnect(1));

// ---------- Pinch tuning (sliders) ----------

type TuningKey = "levelZero" | "levelFull" | "indexOut";
function tuningValue(k: TuningKey): number {
  const o = interaction.options;
  return k === "indexOut" ? o.thresholds.indexOut : o[k];
}
function applyTuning(k: TuningKey, v: number) {
  const o = interaction.options;
  if (k === "indexOut") interaction.configure({ thresholds: { ...o.thresholds, indexOut: v } });
  else interaction.configure({ [k]: v });
}
function paintTuning() {
  for (const input of document.querySelectorAll<HTMLInputElement>("#tuning input")) {
    const k = input.dataset.k as TuningKey;
    input.value = String(tuningValue(k));
    document.querySelector(`#tuning [data-v="${k}"]`)!.textContent = tuningValue(k).toFixed(2);
  }
}
for (const input of document.querySelectorAll<HTMLInputElement>("#tuning input")) {
  input.addEventListener("input", () => {
    applyTuning(input.dataset.k as TuningKey, Number(input.value));
    paintTuning();
  });
}
paintTuning();

checkbox("swapHand").addEventListener("change", (ev) => {
  interaction.configure({ invertHandedness: (ev.target as HTMLInputElement).checked });
});

/** Median thumb–index distance over `ms`, showing a countdown. */
async function measureSeparation(instruction: string, ms: number): Promise<number | null> {
  const samples: number[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const remaining = Math.ceil((ms - (performance.now() - t0)) / 1000);
    $("status").textContent = `${instruction} (${remaining})`;
    $("action").textContent = instruction;
    tAction = performance.now();
    const d = interaction.diagnostics;
    // Only the last second: the first one is for placing the hand.
    if (d && performance.now() - t0 > ms - 1000) samples.push(d.separation);
    await new Promise((r) => setTimeout(r, 50));
  }
  if (samples.length < 5) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

$("calibrate").addEventListener("click", async () => {
  const together = await measureSeparation("🤏 Touch your thumb and index fingertips", 2500);
  const open = together === null ? null : await measureSeparation("🖐️ Now open them wide", 2500);
  if (together === null || open === null || open - together < 0.15) {
    $("status").textContent = "Calibration failed: the hand wasn’t clearly visible. Try again.";
    return;
  }
  interaction.setLevelScale(together, open);
  paintTuning();
  $("status").textContent = `Volume calibrated: together ${together.toFixed(2)}, open ${open.toFixed(2)}.`;
  showAction("Calibrated");
});

async function start() {
  try {
    await openCamera();
    // ?mp=<url> lets MediaPipe be served from another path (e.g. without access to jsDelivr).
    const mediapipeBase = new URLSearchParams(location.search).get("mp") ?? undefined;
    tracker = await createTracker(
      video,
      (f) => {
        lastFrame = f;
        interaction.process(f);
      },
      mediapipeBase ? { mediapipeBase } : {},
    );
    setInterval(() => ($("fps").textContent = tracker!.fps.toFixed(0)), 500);
    $("status").textContent = "Ready — show your hand to the camera.";
    requestAnimationFrame(draw);
  } catch (e) {
    console.error(e);
    $("status").textContent = `Error: ${(e as Error).message}`;
  }
}

start();
