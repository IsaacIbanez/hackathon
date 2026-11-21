// MediaPipe wrapper (HandLandmarker and, optionally, FaceLandmarker): reads frames from a <video>
// and delivers HandFrame objects. It is the only part of the module that depends on the browser
// and on MediaPipe.
//
// MediaPipe is loaded at runtime from a URL (jsDelivr by default) so we don't depend on the
// frontend's package.json yet (T2 creates it). Once it exists, pass
// `loadVision: () => import("@mediapipe/tasks-vision")`.

import type { Face, Hand, HandFrame } from "./types.ts";

export const MEDIAPIPE_VERSION = "0.10.21";
export const MEDIAPIPE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Minimal types for the parts of the MediaPipe API we use.
interface LandmarkMP {
  x: number;
  y: number;
  z: number;
}
interface HandResultMP {
  landmarks: LandmarkMP[][];
  worldLandmarks: LandmarkMP[][];
  handedness: { categoryName: string; score: number }[][];
}
interface FaceResultMP {
  faceLandmarks: LandmarkMP[][];
}
interface DetectorMP<R> {
  detectForVideo(video: HTMLVideoElement, t: number): R;
  close(): void;
}
interface FactoryMP<R> {
  createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<DetectorMP<R>>;
}
interface VisionModuleMP {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  HandLandmarker: FactoryMP<HandResultMP>;
  FaceLandmarker: FactoryMP<FaceResultMP>;
}

export interface TrackerOptions {
  /** Folder containing `vision_bundle.mjs` and `wasm/`. */
  mediapipeBase: string;
  handModel: string;
  faceModel: string;
  loadVision?: () => Promise<VisionModuleMP>;
  /** Hands detected per frame; the interaction follows the one nearest the camera. */
  numHands: number;
  /** Faces detected per frame; the nearest one (largest in the image) is used. */
  numFaces: number;
  /** Maximum frames per second analysed (saves CPU and battery). */
  maxFps: number;
  delegate: "GPU" | "CPU";
  /** Enable face detection from the start (head gestures, experimental). */
  face: boolean;
  /** Only analyse the face every N frames (heads move slowly; saves CPU). */
  faceEveryN: number;
}

const DEFAULTS: TrackerOptions = {
  mediapipeBase: MEDIAPIPE_BASE,
  handModel: HAND_MODEL,
  faceModel: FACE_MODEL,
  numHands: 2,
  numFaces: 2,
  maxFps: 30,
  delegate: "GPU",
  face: false,
  faceEveryN: 2,
};

export interface Tracker {
  stop(): void;
  /** Recreates the detectors (e.g. after switching cameras). */
  restart(): Promise<void>;
  /** Turns face detection on or off (the model is downloaded the first time). */
  enableFace(enabled: boolean): Promise<void>;
  /** Frames analysed per second (recent average). */
  readonly fps: number;
}

export async function createTracker(
  video: HTMLVideoElement,
  onFrame: (f: HandFrame) => void,
  options: Partial<TrackerOptions> = {},
): Promise<Tracker> {
  const o = { ...DEFAULTS, ...options };
  const vision: VisionModuleMP = o.loadVision
    ? await o.loadVision()
    : await import(/* @vite-ignore */ `${o.mediapipeBase}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${o.mediapipeBase}/wasm`);

  // Creates a detector on the GPU and, if that fails, on the CPU.
  async function withFallback<R>(factory: FactoryMP<R>, extra: Record<string, unknown>, model: string) {
    const create = (delegate: "GPU" | "CPU") =>
      factory.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: "VIDEO",
        ...extra,
      });
    try {
      return await create(o.delegate);
    } catch (e) {
      if (o.delegate === "CPU") throw e;
      console.warn("MediaPipe: GPU not available, using CPU", e);
      return await create("CPU");
    }
  }
  const createHands = () =>
    withFallback(
      vision.HandLandmarker,
      {
        numHands: o.numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      },
      o.handModel,
    );
  const createFace = () => withFallback(vision.FaceLandmarker, { numFaces: o.numFaces }, o.faceModel);

  let hands: DetectorMP<HandResultMP> | null = await createHands();
  let face: DetectorMP<FaceResultMP> | null = o.face ? await createFace() : null;
  let faceEnabled = o.face;
  let lastFace: Face | null = null;
  let frameCount = 0;

  let running = true;
  let tLast = -Infinity;
  let fps = 0;
  let dimensions = "";
  const interval = 1000 / o.maxFps;

  // If the video resolution changes (e.g. turning the camera off and on), MediaPipe keeps tracking
  // the previous image and the landmarks come out shifted, so the detectors are recreated.
  let recreating: Promise<void> | null = null;
  const recreate = (): Promise<void> => {
    // If already recreating, don't open a second detector.
    recreating ??= (async () => {
      const [oldHands, oldFace] = [hands, face];
      hands = null;
      face = null;
      oldHands?.close();
      oldFace?.close();
      try {
        hands = await createHands();
        if (faceEnabled) face = await createFace();
      } finally {
        recreating = null;
      }
    })();
    return recreating;
  };

  // requestAnimationFrame instead of requestVideoFrameCallback: it keeps working even if the
  // <video> stream changes or the camera drops for a while. When the page is hidden (e.g. the
  // gesture window sits behind a video call) browsers pause requestAnimationFrame, so a timer
  // takes over. `loop` invalidates the old chain whenever visibility changes.
  let loop = 0;
  const schedule = (id: number) => {
    if (typeof document !== "undefined" && document.hidden) setTimeout(() => step(id), interval);
    else requestAnimationFrame(() => step(id));
  };
  const onVisibility = () => schedule(++loop);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  const step = (id: number) => {
    if (!running || id !== loop) return;
    schedule(id);
    const t = performance.now();
    if (!hands || video.readyState < 2 || video.videoWidth === 0 || t - tLast < interval * 0.9) return;

    const dims = `${video.videoWidth}x${video.videoHeight}`;
    if (dims !== dimensions) {
      const first = dimensions === "";
      dimensions = dims;
      if (!first) {
        console.info(`Camera: new resolution ${dims}, restarting MediaPipe`);
        void recreate();
        return;
      }
    }

    if (tLast > 0) {
      const instant = 1000 / (t - tLast);
      fps = fps === 0 ? instant : 0.9 * fps + 0.1 * instant;
    }
    tLast = t;
    frameCount++;
    const frame = toHandFrame(hands.detectForVideo(video, t), t, video.videoWidth / video.videoHeight);
    if (faceEnabled) {
      if (face && frameCount % o.faceEveryN === 0) lastFace = toFace(face.detectForVideo(video, t));
      frame.face = lastFace;
    }
    onFrame(frame);
  };
  schedule(loop);

  return {
    stop() {
      running = false;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      hands?.close();
      face?.close();
      hands = null;
      face = null;
    },
    restart: recreate,
    async enableFace(enabled: boolean) {
      faceEnabled = enabled;
      lastFace = null;
      if (enabled && !face) face = await createFace();
      if (!enabled && face) {
        face.close();
        face = null;
      }
    },
    get fps() {
      return fps;
    },
  };
}

function toHandFrame(r: HandResultMP, t: number, aspect: number): HandFrame {
  const hands: Hand[] = r.landmarks.map((points, i) => ({
    points: points.map(({ x, y, z }) => ({ x, y, z })),
    worldPoints: r.worldLandmarks[i]?.map(({ x, y, z }) => ({ x, y, z })),
    handedness: r.handedness[i]?.[0]?.categoryName,
    score: r.handedness[i]?.[0]?.score,
  }));
  return { t, hands, aspect };
}

/** Picks the face nearest the camera: the widest one in the image (cheek to cheek). */
function toFace(r: FaceResultMP): Face | null {
  let points: LandmarkMP[] | undefined;
  let widest = -1;
  for (const f of r.faceLandmarks) {
    if (f.length < 455) continue;
    const width = Math.hypot(f[234].x - f[454].x, f[234].y - f[454].y);
    if (width > widest) {
      widest = width;
      points = f;
    }
  }
  if (!points) return null;
  return { points: points.map(({ x, y, z }) => ({ x, y, z })) };
}
