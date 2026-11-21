// Envoltorio de MediaPipe (HandLandmarker y, opcional, FaceLandmarker): lee frames de un <video>
// y entrega FrameManos. Es la única parte del módulo que depende del navegador y de MediaPipe.
//
// MediaPipe se carga en tiempo de ejecución desde una URL (por defecto, jsDelivr) para no
// depender todavía del package.json del frontend (lo crea T2). Cuando exista, se puede
// pasar `cargarVision: () => import("@mediapipe/tasks-vision")`.

import type { Cara, FrameManos, Mano } from "./tipos.ts";

export const VERSION_MEDIAPIPE = "0.10.21";
export const BASE_MEDIAPIPE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION_MEDIAPIPE}`;
export const MODELO_MANOS =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const MODELO_CARA =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Tipos mínimos de la API de MediaPipe que usamos.
interface LandmarkMP {
  x: number;
  y: number;
  z: number;
}
interface ResultadoManosMP {
  landmarks: LandmarkMP[][];
  worldLandmarks: LandmarkMP[][];
  handedness: { categoryName: string; score: number }[][];
}
interface ResultadoCaraMP {
  faceLandmarks: LandmarkMP[][];
}
interface DetectorMP<R> {
  detectForVideo(video: HTMLVideoElement, t: number): R;
  close(): void;
}
interface FabricaMP<R> {
  createFromOptions(fileset: unknown, opciones: Record<string, unknown>): Promise<DetectorMP<R>>;
}
interface ModuloVisionMP {
  FilesetResolver: { forVisionTasks(rutaWasm: string): Promise<unknown> };
  HandLandmarker: FabricaMP<ResultadoManosMP>;
  FaceLandmarker: FabricaMP<ResultadoCaraMP>;
}

export interface OpcionesRastreador {
  /** Carpeta con `vision_bundle.mjs` y `wasm/`. */
  baseMediapipe: string;
  modelo: string;
  modeloCara: string;
  cargarVision?: () => Promise<ModuloVisionMP>;
  numManos: number;
  /** Límite de frames por segundo analizados (ahorra CPU y batería). */
  fpsMax: number;
  delegado: "GPU" | "CPU";
  /** Activar desde el principio la detección de cara (gestos de cabeza, experimental). */
  cara: boolean;
  /** Analizar la cara solo uno de cada N frames (la cabeza se mueve despacio; ahorra CPU). */
  caraCadaN: number;
}

const POR_DEFECTO: OpcionesRastreador = {
  baseMediapipe: BASE_MEDIAPIPE,
  modelo: MODELO_MANOS,
  modeloCara: MODELO_CARA,
  numManos: 1,
  fpsMax: 30,
  delegado: "GPU",
  cara: false,
  caraCadaN: 2,
};

export interface Rastreador {
  detener(): void;
  /** Recrea los detectores (p. ej. tras cambiar de cámara). */
  reiniciar(): Promise<void>;
  /** Activa o desactiva la detección de cara (el modelo se descarga la primera vez). */
  activarCara(activa: boolean): Promise<void>;
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

  // Crea un detector con GPU y, si falla, con CPU.
  async function conRespaldo<R>(fabrica: FabricaMP<R>, opciones: Record<string, unknown>, modelo: string) {
    const crear = (delegate: "GPU" | "CPU") =>
      fabrica.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelo, delegate },
        runningMode: "VIDEO",
        ...opciones,
      });
    try {
      return await crear(o.delegado);
    } catch (e) {
      if (o.delegado === "CPU") throw e;
      console.warn("MediaPipe: GPU no disponible, se usa CPU", e);
      return await crear("CPU");
    }
  }
  const crearManos = () =>
    conRespaldo(
      vision.HandLandmarker,
      {
        numHands: o.numManos,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      },
      o.modelo,
    );
  const crearCara = () =>
    conRespaldo(vision.FaceLandmarker, { numFaces: 1 }, o.modeloCara);

  let manos: DetectorMP<ResultadoManosMP> | null = await crearManos();
  let cara: DetectorMP<ResultadoCaraMP> | null = o.cara ? await crearCara() : null;
  let caraActiva = o.cara;
  let ultimaCara: Cara | null = null;
  let nFrame = 0;

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
      const [viejoManos, viejoCara] = [manos, cara];
      manos = null;
      cara = null;
      viejoManos?.close();
      viejoCara?.close();
      try {
        manos = await crearManos();
        if (caraActiva) cara = await crearCara();
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
    if (!manos || video.readyState < 2 || video.videoWidth === 0 || t - tUltimo < intervalo) return;

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
    nFrame++;
    const frame = convertirManos(manos.detectForVideo(video, t), t, video.videoWidth / video.videoHeight);
    if (caraActiva) {
      if (cara && nFrame % o.caraCadaN === 0) ultimaCara = convertirCara(cara.detectForVideo(video, t));
      frame.cara = ultimaCara;
    }
    alFrame(frame);
  };
  requestAnimationFrame(paso);

  return {
    detener() {
      activo = false;
      manos?.close();
      cara?.close();
      manos = null;
      cara = null;
    },
    reiniciar: recrear,
    async activarCara(activa: boolean) {
      caraActiva = activa;
      ultimaCara = null;
      if (activa && !cara) cara = await crearCara();
      if (!activa && cara) {
        cara.close();
        cara = null;
      }
    },
    get fps() {
      return fps;
    },
  };
}

function convertirManos(r: ResultadoManosMP, t: number, aspecto: number): FrameManos {
  const manos: Mano[] = r.landmarks.map((puntos, i) => ({
    puntos: puntos.map(({ x, y, z }) => ({ x, y, z })),
    puntosMundo: r.worldLandmarks[i]?.map(({ x, y, z }) => ({ x, y, z })),
    lateralidad: r.handedness[i]?.[0]?.categoryName,
    confianza: r.handedness[i]?.[0]?.score,
  }));
  return { t, manos, aspecto };
}

function convertirCara(r: ResultadoCaraMP): Cara | null {
  const puntos = r.faceLandmarks[0];
  if (!puntos) return null;
  return { puntos: puntos.map(({ x, y, z }) => ({ x, y, z })) };
}
