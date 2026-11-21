/// <reference lib="webworker" />
// Runs Whisper (transformers.js) off the main thread, so loading the model and transcribing
// never freeze the camera, the hand drawing or the gestures.
//
// Messages in:  {type: "load", model, transformersUrl}
//               {type: "transcribe", id, audio: Float32Array (16 kHz mono), language}
// Messages out: {type: "progress", percent} · {type: "ready", device} · {type: "error", message, id?}
//               {type: "result", id, text}

type AsrPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
interface TransformersModule {
  pipeline(task: string, model: string, options: Record<string, unknown>): Promise<AsrPipeline>;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let asr: Promise<AsrPipeline> | null = null;

/** WebGPU if available here (faster); otherwise WebAssembly on the CPU. */
async function device(): Promise<{ device: "webgpu" | "wasm"; dtype: unknown }> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  try {
    const adapter = await gpu?.requestAdapter();
    if (adapter) {
      const f16 = adapter.features.has("shader-f16");
      return { device: "webgpu", dtype: { encoder_model: f16 ? "fp16" : "fp32", decoder_model_merged: "q4" } };
    }
  } catch {
    // no usable GPU
  }
  return { device: "wasm", dtype: "q8" };
}

async function load(model: string, transformersUrl: string): Promise<AsrPipeline> {
  const tf = (await import(/* @vite-ignore */ transformersUrl)) as TransformersModule;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) [loaded, total] = [loaded + f.loaded, total + f.total];
    scope.postMessage({ type: "progress", percent: Math.round((100 * loaded) / total) });
  };
  const make = (d: string, dtype: unknown) => tf.pipeline("automatic-speech-recognition", model, { device: d, dtype, progress_callback });
  const chosen = await device();
  try {
    const p = await make(chosen.device, chosen.dtype);
    scope.postMessage({ type: "ready", device: chosen.device });
    return p;
  } catch (err) {
    if (chosen.device === "wasm") throw err;
    const p = await make("wasm", "q8"); // the GPU path failed: the CPU always works
    scope.postMessage({ type: "ready", device: "wasm" });
    return p;
  }
}

scope.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: "load"; model: string; transformersUrl: string }
    | { type: "transcribe"; id: number; audio: Float32Array; language: string };
  if (msg.type === "load") {
    asr ??= load(msg.model, msg.transformersUrl);
    asr.catch((err) => {
      asr = null;
      scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (msg.type === "transcribe") {
    try {
      if (!asr) throw new Error("model not loaded");
      const out = await (await asr)(msg.audio, { language: msg.language, task: "transcribe" });
      const text = Array.isArray(out) ? out.map((x) => x.text).join(" ") : out.text;
      scope.postMessage({ type: "result", id: msg.id, text: text.trim() });
    } catch (err) {
      scope.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
