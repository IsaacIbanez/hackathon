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
let volumen = 1;
let menuElegido: { sector: SectorMenu; centro: Punto; t: number } | null = null;

const bonito = (s: string) => s.replaceAll("_", " ");

// ---------- Eventos ----------

interaccion.on((e) => {
  if (e.tipo === "puntero") {
    $("doc").textContent = e.documento ? `${e.documento.x.toFixed(2)}, ${e.documento.y.toFixed(2)}` : "fuera";
    return;
  }
  if (e.tipo === "nivel") {
    // La pinza fija el volumen de la voz de la demo (efecto real, no solo un evento).
    volumen = e.valor;
    $("volumen").textContent = `${Math.round(volumen * 100)} %`;
    if (e.fase !== "fin") return; // no llenamos el registro con cada movimiento
  }
  const accion = accionDe(e, contexto);
  anotar(e, accion);
  if (e.tipo === "gesto") $("gesto").textContent = e.gesto;
  if (e.tipo === "menu" && e.fase === "elegir" && e.sector) menuElegido = { sector: e.sector, centro: e.centro, t: performance.now() };
  if (e.tipo === "modo") pintarModo();
  if (accion === "volumen" && e.tipo === "nivel") mostrarAccion(accion, `volumen ${Math.round(e.valor * 100)} %`);
  else if (accion) mostrarAccion(accion);
  if (e.tipo === "seleccion" && casilla("vozSel").checked) escucharPregunta(e.documento ?? e.imagen);
});

function anotar(e: EventoManos, accion: string | null) {
  const detalle =
    e.tipo === "gesto" ? e.gesto
    : e.tipo === "deslizar" ? e.direccion
    : e.tipo === "menu" ? `${e.fase}${e.sector ? ` ${e.sector}` : ""}`
    : e.tipo === "nivel" ? `${e.fase} ${Math.round(e.valor * 100)} %`
    : e.tipo === "cabeza" ? e.gesto
    : e.tipo === "modo" ? (e.despierto ? "despierto" : "dormido")
    : e.tipo === "mano" ? (e.presente ? "aparece" : "desaparece")
    : "";
  const li = document.createElement("li");
  li.textContent = `${(e.t / 1000).toFixed(1)} s · ${e.tipo} ${detalle}${accion ? ` → ${bonito(accion)}` : ""}`;
  $("registro").prepend(li);
  while ($("registro").childElementCount > 80) $("registro").lastElementChild!.remove();
}

function mostrarAccion(accion: string, dicho = bonito(accion)) {
  $("accion").textContent = dicho;
  tAccion = performance.now();
  if (casilla("voz").checked) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(dicho);
    u.volume = volumen;
    speechSynthesis.speak(u);
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
  if (activo) $("estado").textContent = "Gestos de cabeza activos: asiente o niega.";
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

const FLECHA: Record<SectorMenu, string> = { arriba: "↑", derecha: "→", abajo: "↓", izquierda: "←" };

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
    ["🤏 junta las puntas de pulgar e índice, luego sepáralas", `${m.pinza ?? "—"}: 0 % juntas, 100 % separadas; cierra el puño para fijarlo`, true],
    ["✌️ victoria → menú", "después ☝️ señala hacia una opción y mantén ~0,5 s", true],
    ...(Object.entries(MENU_RADIAL) as [SectorMenu, string][]).map(
      ([s, a]) => [`   menú ${FLECHA[s]} ${s}`, a, true] as [string, string, boolean],
    ),
    ["🙂 asentir", m.cabeza.asentir, true],
    ["🙂 negar", m.cabeza.negar, true],
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

/** Menú como capa HTML: muestra el lado señalado y el progreso hasta elegirlo. */
function pintarMenu() {
  const t = performance.now();
  const abierto = interaccion.menuAbierto(t);
  const elegido = menuElegido && t - menuElegido.t < 700 ? menuElegido : null;
  $("menu").hidden = !abierto && !elegido;
  for (const op of document.querySelectorAll<HTMLElement>("#menu .op")) {
    const s = op.dataset.s as SectorMenu;
    op.textContent = `${FLECHA[s]} ${bonito(MENU_RADIAL[s])}`;
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
  const n = interaccion.nivelActivo;
  const [ax, ay, bx, by] = [d.pulgar.x * w, d.pulgar.y * h, d.indice.x * w, d.indice.y * h];
  const op = interaccion.opciones;
  const juntos = d.separacion < op.umbrales.pinza && d.alcance >= op.umbrales.indiceFuera;
  ctx.strokeStyle = n ? `hsl(${Math.round(120 * n.valor)}, 90%, 55%)` : juntos ? "#00e0ff" : "#ffffff99";
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
  if (n) {
    texto(`🔊 ${Math.round(n.valor * 100)} %`, mx, my - 10, 34, "#ffd400");
    // Barra de nivel en el borde derecho de la imagen (a la izquierda del usuario, que ve en espejo).
    const altoBarra = h * 0.6;
    const y0 = (h - altoBarra) / 2;
    ctx.fillStyle = "#0009";
    ctx.fillRect(w - 50, y0, 30, altoBarra);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(w - 50, y0 + altoBarra * (1 - n.valor), 30, altoBarra * n.valor);
  } else if (juntos) {
    texto("🤏 pinza: sepáralos para ajustar", mx, my, 22, "#00e0ff");
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

  dibujarPinza(w, h);
  pintarMenu();
  const d = interaccion.diagnostico;
  $("separacion").textContent = d ? `${d.separacion.toFixed(2)} (0 % ≤ ${interaccion.opciones.nivelMin} · 100 % ≥ ${interaccion.opciones.nivelMax})` : "—";
  $("apunta").textContent = d?.direccionIndice ?? "—";

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
