// Página de prueba del módulo de manos. Arrancar con:  npx vite web/src/input  → /demo/
import {
  accionDe,
  CONEXIONES,
  crearRastreador,
  InteraccionManos,
  MAPAS,
  MENU_RADIAL,
  OPCIONES_POR_DEFECTO,
  PERFIL_MOVILIDAD_REDUCIDA,
  type Contexto,
  type Esquinas,
  type EventoManos,
  type FrameManos,
  type Punto,
  type Rastreador,
  type SectorMenu,
} from "../index.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const lienzo = $<HTMLCanvasElement>("lienzo");
const ctx = lienzo.getContext("2d")!;
const casilla = (id: string) => $<HTMLInputElement>(id);

const interaccion = new InteraccionManos();
let rastreador: Rastreador | null = null;
let ultimoFrame: FrameManos | null = null;
let esquinas: Punto[] | null = null;
let marcando: Punto[] | null = null;
let contexto: Contexto = "documento";
let tAccion = 0;

const bonito = (s: string) => s.replaceAll("_", " ");

// ---------- Eventos ----------

interaccion.on((e) => {
  if (e.tipo === "puntero") {
    $("doc").textContent = e.documento ? `${e.documento.x.toFixed(2)}, ${e.documento.y.toFixed(2)}` : "fuera";
    return;
  }
  if (e.tipo === "arrastre" && e.fase === "mover") {
    $("arrastre").textContent = `dx ${e.dx.toFixed(2)} · dy ${e.dy.toFixed(2)}`;
    return;
  }
  const accion = accionDe(e, contexto);
  anotar(e, accion);
  if (e.tipo === "gesto") $("gesto").textContent = e.gesto;
  if (e.tipo === "arrastre" && e.fase === "fin") $("arrastre").textContent = "—";
  if (e.tipo === "modo") pintarModo();
  if (accion) mostrarAccion(accion);
  if (e.tipo === "seleccion" && casilla("vozSel").checked) escucharPregunta(e.documento ?? e.imagen);
});

function anotar(e: EventoManos, accion: string | null) {
  const detalle =
    e.tipo === "gesto" ? e.gesto
    : e.tipo === "deslizar" ? e.direccion
    : e.tipo === "menu" ? `${e.fase}${e.sector ? ` ${e.sector}` : ""}`
    : e.tipo === "arrastre" ? `${e.fase} (dx ${e.dx.toFixed(2)}, dy ${e.dy.toFixed(2)})`
    : e.tipo === "cabeza" ? e.gesto
    : e.tipo === "modo" ? (e.despierto ? "despierto" : "dormido")
    : e.tipo === "mano" ? (e.presente ? "aparece" : "desaparece")
    : "";
  const li = document.createElement("li");
  li.textContent = `${(e.t / 1000).toFixed(1)} s · ${e.tipo} ${detalle}${accion ? ` → ${bonito(accion)}` : ""}`;
  $("registro").prepend(li);
  while ($("registro").childElementCount > 80) $("registro").lastElementChild!.remove();
}

function mostrarAccion(accion: string) {
  $("accion").textContent = bonito(accion);
  tAccion = performance.now();
  if (casilla("voz").checked) {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(bonito(accion)));
  }
}

function pintarModo() {
  const m = $("modo");
  m.hidden = !interaccion.opciones.requiereDespertar;
  m.className = interaccion.estaDespierto ? "despierto" : "dormido";
  m.textContent = interaccion.estaDespierto ? "● despierto" : "● dormido — ✋ mantén la palma";
}

// ---------- Controles ----------

$<HTMLSelectElement>("contexto").addEventListener("change", (ev) => {
  contexto = (ev.target as HTMLSelectElement).value as Contexto;
  pintarChuleta();
});

casilla("despertar").addEventListener("change", (ev) => {
  interaccion.configurar({ requiereDespertar: (ev.target as HTMLInputElement).checked });
  pintarModo();
});

casilla("movilidad").addEventListener("change", (ev) => {
  const activo = (ev.target as HTMLInputElement).checked;
  const base: Record<string, unknown> = {};
  for (const k of Object.keys(PERFIL_MOVILIDAD_REDUCIDA)) base[k] = OPCIONES_POR_DEFECTO[k as keyof typeof OPCIONES_POR_DEFECTO];
  interaccion.configurar(activo ? PERFIL_MOVILIDAD_REDUCIDA : base);
});

casilla("cabeza").addEventListener("change", async (ev) => {
  const activo = (ev.target as HTMLInputElement).checked;
  $("estado").textContent = activo ? "Cargando el modelo de cara…" : "Gestos de cabeza desactivados.";
  await rastreador?.activarCara(activo);
  if (activo) $("estado").textContent = "Gestos de cabeza activos: asiente, niega o cierra los ojos ~1 s.";
});

// Señalar + voz: reconocimiento de voz del navegador (Chrome y Edge; Firefox no lo tiene).
type Reconocedor = { lang: string; interimResults: boolean; onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void; start(): void };
const ClaseReconocedor: (new () => Reconocedor) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
if (!ClaseReconocedor) {
  casilla("vozSel").disabled = true;
  $("vozInfo").textContent = "no disponible en este navegador (prueba con Chrome o Edge)";
}

function escucharPregunta(donde: Punto) {
  if (!ClaseReconocedor) return;
  const r = new ClaseReconocedor();
  r.lang = "es-ES";
  r.interimResults = false;
  $("estado").textContent = "🎤 Escuchando tu pregunta…";
  r.onresult = (e) => {
    const texto = e.results[0][0].transcript;
    const li = document.createElement("li");
    li.textContent = `🎤 «${texto}» sobre (${donde.x.toFixed(2)}, ${donde.y.toFixed(2)})`;
    $("registro").prepend(li);
    mostrarAccion(`pregunta: ${texto}`);
  };
  r.onerror = (e) => ($("estado").textContent = `Voz: ${e.error}`);
  r.onend = () => ($("estado").textContent = "Listo.");
  r.start();
}

function pintarChuleta() {
  const m = MAPAS[contexto];
  const filas: [string, string, boolean][] = [
    ["👍 pulgar arriba (mantener)", m.pulgar_arriba, false],
    ["✋ palma quieta", m.palma, false],
    ["✋↔ deslizar a tu derecha", m.deslizar_derecha, false],
    ["✋↔ deslizar a tu izquierda", m.deslizar_izquierda, false],
    ["☝️ señalar", "mover el puntero", false],
    ["☝️ señalar quieto ~1 s", m.seleccion, false],
    ["👎 pulgar abajo", m.pulgar_abajo, true],
    ["🤏 pinza (OK) y mover", m.arrastre ?? "— (sin uso aquí)", true],
    ["✌️ victoria → menú", "mueve la mano hacia una opción y espera", true],
    ...(Object.entries(MENU_RADIAL) as [SectorMenu, string][]).map(
      ([s, a]) => [`   menú: ${s}`, a, true] as [string, string, boolean],
    ),
    ["🙂 asentir", m.cabeza.asentir, true],
    ["🙂 negar", m.cabeza.negar, true],
    ["😑 ojos cerrados ~1 s", m.cabeza.parpadeo_largo, true],
  ];
  $("chuleta").innerHTML = filas
    .map(([g, a, exp]) => `<tr><td>${g}${exp ? ' <span class="exp">EXP</span>' : ""}</td><td>${bonito(a)}</td></tr>`)
    .join("");
}
pintarChuleta();

// ---------- Marcar documento ----------

$("marcar").addEventListener("click", () => {
  marcando = [];
  esquinas = null;
  interaccion.fijarDocumento(null);
  $("estado").textContent = "Haz clic en las esquinas: sup-izq, sup-der, inf-der, inf-izq (tal como las ves).";
});

lienzo.addEventListener("click", (ev) => {
  if (!marcando) return;
  const r = lienzo.getBoundingClientRect();
  // El lienzo se ve en espejo: deshacemos el espejo para pasar a coordenadas de imagen.
  marcando.push({ x: 1 - (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
  if (marcando.length === 4) {
    // El usuario marca sobre la vista en espejo: su sup-izq es la sup-der de la imagen.
    const [a, b, c, d] = marcando;
    esquinas = [b, a, d, c];
    interaccion.fijarDocumento(esquinas as Esquinas);
    marcando = null;
    $("estado").textContent = "Documento marcado. Señala dentro de él.";
  }
});

// ---------- Dibujo ----------

/** Texto legible sobre el lienzo en espejo. */
function texto(s: string, x: number, y: number, tam = 28, color = "#fff") {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = `700 ${tam}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#000";
  ctx.strokeText(s, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function dibujarMenu(w: number, h: number) {
  const menu = interaccion.menuAbierto;
  if (!menu) return;
  const cx = menu.centro.x * w;
  const cy = menu.centro.y * h;
  const r = interaccion.opciones.radioMenu * h;
  ctx.fillStyle = "#000a";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff55";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // En la imagen sin espejo, la derecha del usuario está a la izquierda.
  const pos: Record<SectorMenu, [number, number]> = {
    arriba: [cx, cy - r * 2],
    abajo: [cx, cy + r * 2],
    derecha: [cx - r * 2, cy],
    izquierda: [cx + r * 2, cy],
  };
  for (const [s, [x, y]] of Object.entries(pos) as [SectorMenu, [number, number]][]) {
    const activo = menu.sector === s;
    texto(bonito(MENU_RADIAL[s]), x, y, activo ? 34 : 26, activo ? "#ffd400" : "#fff");
  }
}

function dibujar() {
  const w = (lienzo.width = video.videoWidth || 640);
  const h = (lienzo.height = video.videoHeight || 480);
  ctx.clearRect(0, 0, w, h);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
  if (!interaccion.estaDespierto) {
    ctx.fillStyle = "#0008";
    ctx.fillRect(0, 0, w, h);
  }

  const quad = esquinas ?? marcando;
  if (quad?.length) {
    ctx.strokeStyle = "#00e0ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    if (esquinas) ctx.closePath();
    ctx.stroke();
  }

  for (const m of ultimoFrame?.manos ?? []) {
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = 3;
    for (const [a, b] of CONEXIONES) {
      ctx.beginPath();
      ctx.moveTo(m.puntos[a].x * w, m.puntos[a].y * h);
      ctx.lineTo(m.puntos[b].x * w, m.puntos[b].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffd400";
    for (const p of m.puntos) ctx.fillRect(p.x * w - 3, p.y * h - 3, 6, 6);

    // Barra de progreso para despertar, sobre la muñeca.
    const prog = interaccion.progresoDespertar(performance.now());
    if (prog > 0) {
      const mu = m.puntos[0];
      ctx.strokeStyle = "#34c759";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(mu.x * w, mu.y * h, 40, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
  }

  const c = ultimoFrame?.cara;
  if (c) {
    ctx.fillStyle = "#00e0ff88";
    for (let i = 0; i < c.puntos.length; i += 6) ctx.fillRect(c.puntos[i].x * w - 1, c.puntos[i].y * h - 1, 2, 2);
  }

  const p = interaccion.puntero;
  if (p) {
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  const a = interaccion.arrastrando;
  if (a && ultimoFrame?.manos[0]) {
    const mu = ultimoFrame.manos[0].puntos[9];
    texto(`🤏 ${a.dy < 0 ? "▲" : "▼"} ${Math.abs(a.dy).toFixed(2)}`, mu.x * w, mu.y * h - 60, 30, "#ffd400");
  }

  dibujarMenu(w, h);

  if (performance.now() - tAccion > 1500) $("accion").textContent = "";
  $("pose").textContent = interaccion.pose;
  requestAnimationFrame(dibujar);
}

// ---------- Cámara ----------

/** Abre la cámara y vigila si se corta, para reconectar sola. */
async function abrirCamara(): Promise<void> {
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  video.srcObject = stream;
  await video.play();
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    $("estado").textContent = "La cámara se ha cortado. Reconectando…";
    void reconectar();
  });
}

async function reconectar(intentos = 20): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      await abrirCamara();
      await rastreador?.reiniciar();
      $("estado").textContent = "Cámara reconectada.";
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  $("estado").textContent = "No se pudo reconectar la cámara. Pulsa «Reiniciar cámara».";
}

$("reiniciar").addEventListener("click", () => void reconectar(1));

async function iniciar() {
  try {
    await abrirCamara();
    // ?mp=<url> permite servir MediaPipe desde otra ruta (p. ej. sin acceso a jsDelivr).
    const baseMediapipe = new URLSearchParams(location.search).get("mp") ?? undefined;
    rastreador = await crearRastreador(
      video,
      (f) => {
        ultimoFrame = f;
        interaccion.procesar(f);
      },
      baseMediapipe ? { baseMediapipe } : {},
    );
    setInterval(() => ($("fps").textContent = rastreador!.fps.toFixed(0)), 500);
    $("estado").textContent = "Listo. Pon la mano delante de la cámara.";
    requestAnimationFrame(dibujar);
  } catch (e) {
    console.error(e);
    $("estado").textContent = `Error: ${(e as Error).message}`;
  }
}

iniciar();
