// Página de prueba del módulo de manos. Arrancar con:  npx vite web/src/input  → /demo/
import {
  accionDe,
  CONEXIONES,
  crearRastreador,
  InteraccionManos,
  MAPAS,
  menuPara,
  OPCIONES_POR_DEFECTO,
  PERFIL_MOVILIDAD_REDUCIDA,
  type Contexto,
  type Esquinas,
  type EventoManos,
  type FrameManos,
  type Punto,
  type LadoMano,
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
let volumen = 1;
let menuElegido: { sector: SectorMenu; centro: Punto; mano: LadoMano | null; t: number } | null = null;
let manoMostrada: LadoMano | null | undefined;

// ---------- Textos de la interfaz (en inglés) ----------

const ACCIONES_EN: Record<string, string> = {
  leer: "Read", pausar: "Pause", siguiente: "Next", anterior: "Previous", explicar_aqui: "Explain this",
  confirmar_campo: "Confirm field", campo_siguiente: "Next field", campo_anterior: "Previous field",
  dictar_campo: "Dictate field", borrar_campo: "Clear field", intro: "Enter", escape: "Escape",
  pestana_siguiente: "Next tab", pestana_anterior: "Previous tab", clic: "Click", deshacer: "Undo",
  volumen: "Volume", despertar: "Awake", dormir: "Asleep", ajustar_volumen: "Adjust volume",
  repetir: "Repeat", copiar_texto: "Copy text", dictar: "Dictate", pedir_ayuda: "Ask for help",
};
const GESTOS_EN: Record<string, string> = {
  ninguno: "—", senalar: "Pointing", palma: "Open palm", puno: "Fist", pulgar_arriba: "Thumbs up",
  pulgar_abajo: "Thumbs down", victoria: "Victory", pinza: "Pinch",
};
const SECTORES_EN: Record<SectorMenu, string> = { arriba: "up", derecha: "right", abajo: "down", izquierda: "left" };
const CONTEXTOS_EN: Record<Contexto, string> = { documento: "Reading", formulario: "Form", pc: "Computer" };
const MANO_EN: Record<LadoMano, string> = { derecha: "Right", izquierda: "Left" };

/** Texto en inglés de una acción (o de cualquier texto ya escrito). */
const bonito = (s: string) => ACCIONES_EN[s] ?? s.replaceAll("_", " ");
const gestoEn = (g: string) => GESTOS_EN[g] ?? g;

// ---------- Eventos ----------

interaccion.on((e) => {
  if (e.tipo === "puntero") {
    $("doc").textContent = e.documento ? `${e.documento.x.toFixed(2)}, ${e.documento.y.toFixed(2)}` : "outside";
    return;
  }
  if (e.tipo === "nivel" && (e.fase === "inicio" || e.fase === "mover" || e.fase === "fin")) {
    // La pinza fija el volumen de la voz de la demo (efecto real, no solo un evento).
    volumen = e.valor;
    $("volumen").textContent = `${Math.round(volumen * 100)} %`;
    $("medidorVolumen").style.width = `${Math.round(volumen * 100)}%`;
    if (e.fase !== "fin") return; // no llenamos el registro con cada movimiento
  }
  const accion = accionDe(e, contexto);
  anotar(e, accion);
  if (e.tipo === "gesto") $("gesto").textContent = gestoEn(e.gesto);
  if (e.tipo === "menu" && e.fase === "elegir" && e.sector) menuElegido = { sector: e.sector, centro: e.centro, mano: e.mano, t: performance.now() };
  if (e.tipo === "modo") pintarModo();
  if (accion === "volumen" && e.tipo === "nivel") mostrarAccion(accion, `Volume ${Math.round(e.valor * 100)} %`);
  else if (accion) mostrarAccion(accion);
  // Elegir "ajustar volumen" en el menú arma el control: después hay que juntar los dedos.
  if (accion === "ajustar_volumen") interaccion.iniciarNivel();
  if (e.tipo === "nivel" && e.fase === "cancelar") mostrarAccion("Volume cancelled");
  if (e.tipo === "seleccion" && casilla("vozSel").checked) escucharPregunta(e.documento ?? e.imagen);
});

const FASES_EN: Record<string, string> = {
  abrir: "open", resaltar: "highlight", elegir: "chosen", cerrar: "closed",
  esperar: "armed", inicio: "start", mover: "move", fin: "set", cancelar: "cancelled",
};
const TIPOS_EN: Record<string, string> = {
  gesto: "Gesture", deslizar: "Swipe", menu: "Menu", nivel: "Volume", cabeza: "Head", modo: "Mode",
  mano: "Hand", seleccion: "Select", puntero: "Pointer",
};

function anotar(e: EventoManos, accion: string | null) {
  const detalle =
    e.tipo === "gesto" ? gestoEn(e.gesto)
    : e.tipo === "deslizar" ? (e.direccion === "derecha" ? "right" : "left")
    : e.tipo === "menu" ? `${FASES_EN[e.fase]}${e.sector ? ` ${SECTORES_EN[e.sector]}` : ""}`
    : e.tipo === "nivel" ? `${FASES_EN[e.fase]} ${Math.round(e.valor * 100)} %`
    : e.tipo === "cabeza" ? (e.gesto === "asentir" ? "nod" : "shake")
    : e.tipo === "modo" ? (e.despierto ? "awake" : "asleep")
    : e.tipo === "mano" ? (e.presente ? "appears" : "lost")
    : "";
  const li = document.createElement("li");
  li.textContent = `${(e.t / 1000).toFixed(1)} s · ${TIPOS_EN[e.tipo] ?? e.tipo} ${detalle}${accion ? ` → ${bonito(accion)}` : ""}`;
  $("registro").prepend(li);
  while ($("registro").childElementCount > 80) $("registro").lastElementChild!.remove();
}

function mostrarAccion(accion: string, dicho = bonito(accion)) {
  $("accion").textContent = dicho;
  tAccion = performance.now();
  if (casilla("voz").checked) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(dicho);
    u.lang = "en-US";
    u.volume = volumen;
    speechSynthesis.speak(u);
  }
}

function pintarModo() {
  const m = $("modo");
  m.hidden = !interaccion.opciones.requiereDespertar;
  m.className = interaccion.estaDespierto ? "despierto" : "dormido";
  m.textContent = interaccion.estaDespierto ? "● Awake" : "● Asleep — hold an open palm";
}

// ---------- Controles ----------

for (const b of document.querySelectorAll<HTMLButtonElement>("#contexto button")) {
  b.addEventListener("click", () => {
    contexto = b.dataset.c as Contexto;
    for (const o of document.querySelectorAll<HTMLButtonElement>("#contexto button")) {
      o.setAttribute("aria-pressed", String(o === b));
    }
    pintarChuleta();
  });
}

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
  $("estado").textContent = activo ? "Loading the face model…" : "Head gestures off.";
  await rastreador?.activarCara(activo);
  if (activo) $("estado").textContent = "Head gestures on: nod or shake your head.";
});

// Señalar + voz: reconocimiento de voz del navegador (Chrome y Edge; Firefox no lo tiene).
type Reconocedor = { lang: string; interimResults: boolean; onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void; start(): void };
const ClaseReconocedor: (new () => Reconocedor) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
if (!ClaseReconocedor) {
  casilla("vozSel").disabled = true;
  $("vozInfo").textContent = "Not available in this browser (try Chrome or Edge)";
}

function escucharPregunta(donde: Punto) {
  if (!ClaseReconocedor) return;
  const r = new ClaseReconocedor();
  r.lang = "en-US";
  r.interimResults = false;
  $("estado").textContent = "🎤 Listening to your question…";
  r.onresult = (e) => {
    const texto = e.results[0][0].transcript;
    const li = document.createElement("li");
    li.textContent = `🎤 “${texto}” at (${donde.x.toFixed(2)}, ${donde.y.toFixed(2)})`;
    $("registro").prepend(li);
    mostrarAccion(`Question: ${texto}`);
  };
  r.onerror = (e) => ($("estado").textContent = `Voice: ${e.error}`);
  r.onend = () => ($("estado").textContent = "Ready.");
  r.start();
}

const FLECHA: Record<SectorMenu, string> = { arriba: "↑", derecha: "→", abajo: "↓", izquierda: "←" };

function pintarChuleta() {
  const m = MAPAS[contexto];
  $("contextoNombre").textContent = CONTEXTOS_EN[contexto];
  const filas: [string, string, boolean][] = [
    ["👍 Thumbs up (hold)", m.pulgar_arriba, false],
    ["✋ Open palm facing the camera (hold still)", m.palma, false],
    ["✋→ Swipe to your right", m.deslizar_derecha, false],
    ["✋← Swipe to your left", m.deslizar_izquierda, false],
    ["☝️ Point", "Move the pointer", false],
    ["☝️ Point and hold still ~1 s", m.seleccion, false],
    ["👎 Thumbs down", m.pulgar_abajo, true],
    ["✌️ Victory", "Open the quick menu, then move the pointer onto an option and hold ~0.5 s", true],
    ...(Object.entries(menuPara(interaccion.manoUsada)) as [SectorMenu, string][]).map(
      ([s, a]) => [`      Menu ${FLECHA[s]} ${SECTORES_EN[s]}`, a, true] as [string, string, boolean],
    ),
    ["🤏 After “Adjust volume”: pinch, then open", "Volume in 10 % steps; hold still ~1 s to set it", true],
    ["🙂 Nod", m.cabeza.asentir, true],
    ["🙂 Shake your head", m.cabeza.negar, true],
  ];
  $("chuleta").innerHTML = filas
    .map(([g, a, exp]) => `<tr><td>${g}${exp ? '<i class="badge">BETA</i>' : ""}</td><td>${bonito(a)}</td></tr>`)
    .join("");
}
pintarChuleta();

// ---------- Marcar documento ----------

$("marcar").addEventListener("click", () => {
  marcando = [];
  esquinas = null;
  interaccion.fijarDocumento(null);
  $("estado").textContent = "Click the document corners: top-left, top-right, bottom-right, bottom-left (as you see them).";
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
    $("estado").textContent = "Document marked. Point inside it.";
  }
});

// ---------- Dibujo ----------

/** Texto legible sobre el lienzo en espejo. */
function texto(s: string, x: number, y: number, tam = 28, color = "#fff") {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = `700 ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#000";
  ctx.strokeText(s, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** Menú como capa HTML: muestra el lado señalado y el progreso hasta elegirlo. */
function pintarMenu() {
  const t = performance.now();
  const abierto = interaccion.menuAbierto(t);
  const elegido = menuElegido && t - menuElegido.t < 700 ? menuElegido : null;
  $("menu").hidden = !abierto && !elegido;
  const opciones = menuPara(abierto?.mano ?? elegido?.mano ?? null);
  for (const op of document.querySelectorAll<HTMLElement>("#menu .op")) {
    const s = op.dataset.s as SectorMenu;
    const accion = opciones[s];
    // El lado de la mano que se usa no tiene opción (señalar hacia fuera cuesta).
    op.style.visibility = accion ? "visible" : "hidden";
    op.textContent = accion ? `${FLECHA[s]} ${bonito(accion)}` : "";
    const activa = abierto?.sector === s;
    op.classList.toggle("activa", activa);
    op.classList.toggle("elegida", elegido?.sector === s);
    op.style.setProperty("--p", activa ? String(abierto!.progreso) : "0");
  }
}

/** Línea entre pulgar e índice: fina siempre (para ver qué mide la app), gruesa con la pinza activa. */
function dibujarPinza(w: number, h: number) {
  const d = interaccion.diagnostico;
  if (!d) return;
  const n = interaccion.nivelActivo(performance.now());
  const [ax, ay, bx, by] = [d.pulgar.x * w, d.pulgar.y * h, d.indice.x * w, d.indice.y * h];
  const op = interaccion.opciones;
  // Solo se avisa de la pinza cuando el volumen está armado desde el menú; si no, no hace nada.
  const juntos =
    interaccion.nivelEsperando && d.separacion <= op.nivelCero && d.alcance >= op.umbrales.indiceFuera;
  ctx.strokeStyle = n ? `hsl(${Math.round(120 * n.valor)}, 90%, 55%)` : juntos ? "#4cc9f0" : "#ffffff99";
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
  // La medida de la línea, siempre visible junto a ella.
  texto(d.separacion.toFixed(2), mx + 40, (ay + by) / 2, 20, "#fff");
  if (n) {
    texto(`🔊 ${Math.round(n.valor * 100)} %`, mx, my - 10, 40, "#ffd23f");
    // Anillo de confirmación: se llena si te quedas quieto en el mismo valor.
    if (n.progresoConfirmar > 0) {
      ctx.strokeStyle = "#3ddc97";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(mx, my + 30, 18, -Math.PI / 2, -Math.PI / 2 + n.progresoConfirmar * Math.PI * 2);
      ctx.stroke();
    }
    // Barra en escalones de 10 % en el borde derecho de la imagen (a la izquierda del usuario).
    const altoBarra = h * 0.7;
    const y0 = (h - altoBarra) / 2;
    const xb = w - 70;
    const alto10 = altoBarra / 10;
    for (let i = 0; i < 10; i++) {
      const lleno = (i + 1) / 10 <= n.valor + 1e-6;
      ctx.fillStyle = lleno ? `hsl(${Math.round(12 * (i + 1))}, 90%, 55%)` : "#000a";
      ctx.fillRect(xb, y0 + altoBarra - (i + 1) * alto10 + 2, 44, alto10 - 4);
    }
    // Marca fina con la posición real de los dedos (sin redondear).
    ctx.fillStyle = "#fff";
    ctx.fillRect(xb - 10, y0 + altoBarra * (1 - n.continuo) - 2, 64, 4);
  } else if (juntos) {
    texto("🤏 Pinched — now open your fingers", mx, my, 22, "#4cc9f0");
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
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    if (esquinas) ctx.closePath();
    ctx.stroke();
  }

  for (const m of ultimoFrame?.manos ?? []) {
    ctx.strokeStyle = "#ffffffb3";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const [a, b] of CONEXIONES) {
      ctx.beginPath();
      ctx.moveTo(m.puntos[a].x * w, m.puntos[a].y * h);
      ctx.lineTo(m.puntos[b].x * w, m.puntos[b].y * h);
      ctx.stroke();
    }
    for (const [i, p] of m.puntos.entries()) {
      const punta = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.fillStyle = punta ? "#ffd23f" : "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, punta ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barra de progreso para despertar, sobre la muñeca.
    const prog = interaccion.progresoDespertar(performance.now());
    if (prog > 0) {
      const mu = m.puntos[0];
      ctx.strokeStyle = "#3ddc97";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(mu.x * w, mu.y * h, 40, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
  }

  const c = ultimoFrame?.cara;
  if (c) {
    ctx.fillStyle = "#4cc9f088";
    for (let i = 0; i < c.puntos.length; i += 6) ctx.fillRect(c.puntos[i].x * w - 1, c.puntos[i].y * h - 1, 2, 2);
  }

  const p = interaccion.puntero;
  if (p) {
    ctx.fillStyle = "#ff5d5d";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  dibujarPinza(w, h);
  if (interaccion.nivelEsperando) texto("🤏 Pinch your thumb and index finger to start", w / 2, h * 0.14, 34, "#4cc9f0");
  pintarMenu();
  const d = interaccion.diagnostico;
  const esc = interaccion.escalaNivel;
  $("separacion").textContent = d
    ? `${d.separacion.toFixed(2)}  (0 % ≤ ${esc.cero.toFixed(2)} · 100 % ≥ ${esc.lleno.toFixed(2)})`
    : "—";
  $("alcance").textContent = d ? `${d.alcance.toFixed(2)}  (start ≥ ${interaccion.opciones.umbrales.indiceFuera.toFixed(2)})` : "—";
  // Puntero por encima del menú (la capa del menú tapa el lienzo). El lienzo va en espejo.
  const cur = $("cursor");
  cur.hidden = !(interaccion.menuAbierto(performance.now()) && p);
  if (!cur.hidden && p) {
    cur.style.left = `${(1 - p.x) * 100}%`;
    cur.style.top = `${p.y * 100}%`;
  }
  if (interaccion.manoUsada !== manoMostrada) {
    manoMostrada = interaccion.manoUsada;
    $("manoUsada").textContent = manoMostrada ? MANO_EN[manoMostrada] : "detecting…";
    $("chipMano").textContent = `Hand: ${manoMostrada ? MANO_EN[manoMostrada] : "detecting…"}`;
    pintarChuleta(); // el menú cambia según la mano
  }

  if (performance.now() - tAccion > 1500) $("accion").textContent = "";
  $("pose").textContent = gestoEn(interaccion.pose);
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
    $("estado").textContent = "The camera stopped. Reconnecting…";
    void reconectar();
  });
}

async function reconectar(intentos = 20): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      await abrirCamara();
      await rastreador?.reiniciar();
      $("estado").textContent = "Camera reconnected.";
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  $("estado").textContent = "Couldn’t reconnect the camera. Press “Restart camera”.";
}

$("reiniciar").addEventListener("click", () => void reconectar(1));
// ---------- Ajustes de la pinza (deslizadores) ----------

type ClaveAjuste = "nivelCero" | "nivelLleno" | "indiceFuera";
function valorAjuste(k: ClaveAjuste): number {
  const o = interaccion.opciones;
  return k === "indiceFuera" ? o.umbrales.indiceFuera : o[k];
}
function aplicarAjuste(k: ClaveAjuste, v: number) {
  const o = interaccion.opciones;
  if (k === "indiceFuera") interaccion.configurar({ umbrales: { ...o.umbrales, indiceFuera: v } });
  else interaccion.configurar({ [k]: v });
}
function pintarAjustes() {
  for (const input of document.querySelectorAll<HTMLInputElement>("#ajustes input")) {
    const k = input.dataset.k as ClaveAjuste;
    input.value = String(valorAjuste(k));
    document.querySelector(`#ajustes [data-v="${k}"]`)!.textContent = valorAjuste(k).toFixed(2);
  }
}
for (const input of document.querySelectorAll<HTMLInputElement>("#ajustes input")) {
  input.addEventListener("input", () => {
    aplicarAjuste(input.dataset.k as ClaveAjuste, Number(input.value));
    pintarAjustes();
  });
}
pintarAjustes();

casilla("invertirMano").addEventListener("change", (ev) => {
  interaccion.configurar({ invertirLateralidad: (ev.target as HTMLInputElement).checked });
});

/** Mediana de la separación pulgar–índice durante `ms`, mostrando una cuenta atrás. */
async function medirSeparacion(instruccion: string, ms: number): Promise<number | null> {
  const muestras: number[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const faltan = Math.ceil((ms - (performance.now() - t0)) / 1000);
    $("estado").textContent = `${instruccion} (${faltan})`;
    $("accion").textContent = instruccion;
    tAccion = performance.now();
    const d = interaccion.diagnostico;
    // Solo el último segundo: el primero es para colocar la mano.
    if (d && performance.now() - t0 > ms - 1000) muestras.push(d.separacion);
    await new Promise((r) => setTimeout(r, 50));
  }
  if (muestras.length < 5) return null;
  muestras.sort((a, b) => a - b);
  return muestras[Math.floor(muestras.length / 2)];
}

$("recalibrar").addEventListener("click", async () => {
  const juntos = await medirSeparacion("🤏 Touch your thumb and index fingertips", 2500);
  const abiertos = juntos === null ? null : await medirSeparacion("🖐️ Now open them wide", 2500);
  if (juntos === null || abiertos === null || abiertos - juntos < 0.15) {
    $("estado").textContent = "Calibration failed: the hand wasn’t clearly visible. Try again.";
    return;
  }
  interaccion.fijarEscalaNivel(juntos, abiertos);
  pintarAjustes();
  $("estado").textContent = `Volume calibrated: together ${juntos.toFixed(2)}, open ${abiertos.toFixed(2)}.`;
  mostrarAccion("Calibrated");
});

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
    $("estado").textContent = "Ready — show your hand to the camera.";
    requestAnimationFrame(dibujar);
  } catch (e) {
    console.error(e);
    $("estado").textContent = `Error: ${(e as Error).message}`;
  }
}

iniciar();
