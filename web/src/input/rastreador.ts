// Envoltorio de MediaPipe HandLandmarker: lee frames de un <video> y entrega FrameManos.
// Es la única parte del módulo que depende del navegador y de MediaPipe.
//
// MediaPipe se carga en tiempo de ejecución desde una URL (por defecto, jsDelivr) para no
// depender todavía del package.json del frontend (lo crea T2). Cuando exista, se puede
// pasar `cargarVision: () => import("@mediapipe/tasks-vision")`.

import type { FrameManos, Mano } from "./tipos.ts";

export const VERSION_MEDIAPIPE = "0.10.21";
export const BASE_MEDIAPIPE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION_MEDIAPIPE}`;
export const MODELO_MANOS =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Tipos mínimos de la API de MediaPipe que usamos.
interface LandmarkMP {
  x: number;
  y: number;
  z: number;
}
interface ResultadoMP {
  landmarks: LandmarkMP[][];
  worldLandmarks: LandmarkMP[][];
  handedness: { categoryName: string; score: number }[][];
}
interface HandLandmarkerMP {
  detectForVideo(video: HTMLVideoElement, t: number): ResultadoMP;
  close(): void;
}
interface ModuloVisionMP {
  FilesetResolver: { forVisionTasks(rutaWasm: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, opciones: Record<string, unknown>): Promise<HandLandmarkerMP>;
  };
}

export interface OpcionesRastreador {
  /** Carpeta con `vision_bundle.mjs` y `wasm/`. */
  baseMediapipe: string;
  modelo: string;
  cargarVision?: () => Promise<ModuloVisionMP>;
  numManos: number;
  /** Límite de frames por segundo analizados (ahorra CPU y batería). */
  fpsMax: number;
  delegado: "GPU" | "CPU";
}

const POR_DEFECTO: OpcionesRastreador = {
  baseMediapipe: BASE_MEDIAPIPE,
  modelo: MODELO_MANOS,
  numManos: 1,
  fpsMax: 30,
  delegado: "GPU",
};

export interface Rastreador {
  detener(): void;
  /** Recrea el detector (p. ej. tras cambiar de cámara). */
  reiniciar(): Promise<void>;
  /** Frames analizados por segundo (media reciente). */
  readonly fps: number;
}

export async function crearRastreador(
  video: HTMLVideoElement,
  alFrame: (f: FrameManos) => void,
  op: Partial<OpcionesRastreador> = {},
): Promise<Rastreador> {
  const o = { ...POR_DEFECTO, ...op };
  const vision: ModuloVisionMP = o.cargarVision
    ? await o.cargarVision()
    : await import(/* @vite-ignore */ `${o.baseMediapipe}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${o.baseMediapipe}/wasm`);

  const crear = (delegate: "GPU" | "CPU") =>
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: o.modelo, delegate },
      runningMode: "VIDEO",
      numHands: o.numManos,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  const crearConRespaldo = async (): Promise<HandLandmarkerMP> => {
    try {
      return await crear(o.delegado);
    } catch (e) {
      if (o.delegado === "CPU") throw e;
      console.warn("MediaPipe: GPU no disponible, se usa CPU", e);
      return await crear("CPU");
    }
  };
  let detector: HandLandmarkerMP | null = await crearConRespaldo();

  let activo = true;
  let tUltimo = -Infinity;
  let fps = 0;
  let dimensiones = "";
  const intervalo = 1000 / o.fpsMax;

  // Si la resolución del vídeo cambia (p. ej. al apagar y encender la cámara), MediaPipe
  // conserva el seguimiento de la imagen anterior y los puntos salen desplazados: se recrea.
  let recreando: Promise<void> | null = null;
  const recrear = (): Promise<void> => {
    // Si ya se está recreando, no abrimos un segundo detector.
    recreando ??= (async () => {
      const viejo = detector;
      detector = null;
      viejo?.close();
      try {
        detector = await crearConRespaldo();
      } finally {
        recreando = null;
      }
    })();
    return recreando;
  };

  // requestAnimationFrame en vez de requestVideoFrameCallback: sigue funcionando aunque se
  // cambie el stream del <video> o la cámara se corte un rato.
  const paso = () => {
    if (!activo) return;
    requestAnimationFrame(paso);
    const t = performance.now();
    if (!detector || video.readyState < 2 || video.videoWidth === 0 || t - tUltimo < intervalo) return;

    const dims = `${video.videoWidth}x${video.videoHeight}`;
    if (dims !== dimensiones) {
      const primera = dimensiones === "";
      dimensiones = dims;
      if (!primera) {
        console.info(`Cámara: nueva resolución ${dims}, se reinicia MediaPipe`);
        void recrear();
        return;
      }
    }

    if (tUltimo > 0) {
      const instantaneo = 1000 / (t - tUltimo);
      fps = fps === 0 ? instantaneo : 0.9 * fps + 0.1 * instantaneo;
    }
    tUltimo = t;
    const r = detector.detectForVideo(video, t);
    alFrame(convertir(r, t, video.videoWidth / video.videoHeight));
  };
  requestAnimationFrame(paso);

  return {
    detener() {
      activo = false;
      detector?.close();
      detector = null;
    },
    reiniciar: recrear,
    get fps() {
      return fps;
    },
  };
}

function convertir(r: ResultadoMP, t: number, aspecto: number): FrameManos {
  const manos: Mano[] = r.landmarks.map((puntos, i) => ({
    puntos: puntos.map(({ x, y, z }) => ({ x, y, z })),
    puntosMundo: r.worldLandmarks[i]?.map(({ x, y, z }) => ({ x, y, z })),
    lateralidad: r.handedness[i]?.[0]?.categoryName,
    confianza: r.handedness[i]?.[0]?.score,
  }));
  return { t, manos, aspecto };
}
