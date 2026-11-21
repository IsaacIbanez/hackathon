// Página de prueba del módulo de manos. Arrancar con:  npx vite web/src/input  → /demo/
import { accionDe, CONEXIONES, crearRastreador, InteraccionManos, type Esquinas, type FrameManos, type Punto } from "../index.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const lienzo = $<HTMLCanvasElement>("lienzo");
const ctx = lienzo.getContext("2d")!;

const interaccion = new InteraccionManos();
let ultimoFrame: FrameManos | null = null;
let esquinas: Punto[] | null = null;
let marcando: Punto[] | null = null;

interaccion.on((e) => {
  if (e.tipo === "puntero") {
    $("doc").textContent = e.documento ? `${e.documento.x.toFixed(2)}, ${e.documento.y.toFixed(2)}` : "fuera";
    return;
  }
  const accion = accionDe(e);
  const li = document.createElement("li");
  li.textContent = `${(e.t / 1000).toFixed(1)} s · ${e.tipo}${"gesto" in e ? `: ${e.gesto}` : ""}${"direccion" in e ? `: ${e.direccion}` : ""}${accion ? ` → ${accion}` : ""}`;
  $("registro").prepend(li);
  if (e.tipo === "gesto") $("gesto").textContent = e.gesto;
  if (accion) {
    $("accion").textContent = accion.replace("_", " ");
    if ($<HTMLInputElement>("voz").checked) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(accion.replace("_", " ")));
    }
  }
});

$("marcar").addEventListener("click", () => {
  marcando = [];
  esquinas = null;
  interaccion.fijarDocumento(null);
  $("estado").textContent = "Haz clic en las esquinas: sup-izq, sup-der, inf-der, inf-izq (desde tu punto de vista).";
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

function dibujar() {
  const w = (lienzo.width = video.videoWidth || 640);
  const h = (lienzo.height = video.videoHeight || 480);
  ctx.clearRect(0, 0, w, h);
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
  }
  const p = interaccion.puntero;
  if (p) {
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  $("pose").textContent = interaccion.pose;
  requestAnimationFrame(dibujar);
}

async function iniciar() {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    await video.play();
    // ?mp=<url> permite servir MediaPipe desde otra ruta (p. ej. sin acceso a jsDelivr).
    const baseMediapipe = new URLSearchParams(location.search).get("mp") ?? undefined;
    const rastreador = await crearRastreador(
      video,
      (f) => {
        ultimoFrame = f;
        interaccion.procesar(f);
      },
      baseMediapipe ? { baseMediapipe } : {},
    );
    setInterval(() => ($("fps").textContent = rastreador.fps.toFixed(0)), 500);
    $("estado").textContent = "Listo. Pon la mano delante de la cámara.";
    requestAnimationFrame(dibujar);
  } catch (e) {
    console.error(e);
    $("estado").textContent = `Error: ${(e as Error).message}`;
  }
}

iniciar();
