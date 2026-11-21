// Speech recognition, push-to-talk (only while the user asks, never always-on):
// - WebSpeechListener: the browser's recognizer (Chrome, Edge). Fast, but sends audio to the
//   browser vendor's servers and is missing in embedded webviews (Wails: WebView2, WebKitGTK).
// - WhisperListener: Whisper running locally in the page (transformers.js, WASM). Works in any
//   modern webview and the audio never leaves the computer. The model (~40 MB) downloads once.
// - AutoListener: inside the desktop app (Wails) goes straight to Whisper; in a browser it tries
//   the browser recognizer first and switches to Whisper for good if it doesn't really work.

import { EnergyVad, resampleTo16kHQ } from "./vad.ts";

export interface ListenOptions {
  /** BCP-47 language, e.g. "es-ES". */
  lang: string;
  /** Live (partial) transcript, for captions. */
  onPartial?: (text: string) => void;
  /** Status messages (e.g. model download progress). */
  onStatus?: (text: string) => void;
  /** Hard limit for one question. */
  maxMs?: number;
  /** Gives up if the user doesn't start talking within this time. */
  startTimeoutMs?: number;
}

export interface Listener {
  readonly name: string;
  available(): boolean;
  /** Listens to one phrase and resolves with its text ("" if nothing was said). */
  listen(options: ListenOptions): Promise<string>;
  /** Whether it can answer at once (false while a model is still downloading). Default: true. */
  readonly ready?: boolean;
  /** Stops listening now and keeps what was said so far (the user says they're done). */
  finish(): void;
  cancel(): void;
}

/** A recognition error; `code` is the Web Speech error name. */
export class ListenError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

/** Errors that just mean "the user didn't say anything": not a reason to change recognizer. */
const NOTHING_SAID = new Set(["no-speech", "aborted"]);

/**
 * true inside the Wails desktop app. Its webviews (WebView2 on Windows, WebKitGTK on Linux) either
 * lack the browser recognizer or expose it without a working speech service.
 */
export function isDesktopWebview(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.go === "object" || typeof (w.runtime as Record<string, unknown> | undefined)?.EventsOn === "function";
}

// ---------------------------------------------------------------------------------------------
// Browser recognizer

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionClass(): (new () => RecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => RecognitionLike) | undefined;
}

export class WebSpeechListener implements Listener {
  readonly name = "browser speech recognition";
  private current: RecognitionLike | null = null;

  available(): boolean {
    return recognitionClass() !== undefined;
  }

  listen(o: ListenOptions): Promise<string> {
    const Ctor = recognitionClass();
    if (!Ctor) return Promise.reject(new ListenError("unsupported"));
    return new Promise((resolve, reject) => {
      const r = new Ctor();
      this.current = r;
      r.lang = o.lang;
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let final = "";
      let interim = "";
      let settled = false;
      // In a noisy room the recognizer may never mark a result as final: keep the interim one.
      const heard = () => (final || interim).trim();
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.current = null;
        fn();
      };
      const timer = setTimeout(() => r.stop(), o.maxMs ?? 12000);
      r.onresult = (e) => {
        interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        o.onPartial?.((final + interim).trim());
      };
      r.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") done(() => resolve(heard()));
        else done(() => reject(new ListenError(e.error)));
      };
      r.onend = () => done(() => resolve(heard()));
      try {
        r.start();
      } catch (err) {
        done(() => reject(new ListenError("unsupported", String(err))));
      }
    });
  }

  finish(): void {
    this.current?.stop();
  }

  cancel(): void {
    this.current?.abort();
  }
}

// ---------------------------------------------------------------------------------------------
// Local Whisper

export const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
/** Whisper models by size. Measured in docs/VOZ.md: small is exact in Spanish, tiny is not. */
export const WHISPER_MODELS = {
  small: "onnx-community/whisper-small", // ~250 MB, ~1 s per question
  tiny: "onnx-community/whisper-tiny", // ~40 MB, for slow computers only
} as const;
export type WhisperSize = keyof typeof WHISPER_MODELS;

/**
 * Model for this computer: small, unless it looks slow (little memory or few cores) or the user
 * chose one (localStorage "whisper" = "small" | "tiny", or ?whisper=tiny in the URL).
 */
export function chooseWhisperSize(env: { deviceMemory?: number; cores?: number; override?: string | null }): WhisperSize {
  if (env.override === "small" || env.override === "tiny") return env.override;
  if ((env.deviceMemory !== undefined && env.deviceMemory < 4) || (env.cores !== undefined && env.cores <= 2)) return "tiny";
  return "small";
}

function whisperSizeHere(): WhisperSize {
  if (typeof navigator === "undefined") return "small";
  let override: string | null = null;
  try {
    override = new URLSearchParams(globalThis.location?.search ?? "").get("whisper") ?? globalThis.localStorage?.getItem("whisper") ?? null;
  } catch {
    // storage blocked: use the automatic choice
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return chooseWhisperSize({ deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency, override });
}

/** WebGPU if the window has it (faster); otherwise WebAssembly on the CPU. */
async function whisperDevice(): Promise<{ device: "webgpu" | "wasm"; dtype: unknown }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
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

const WHISPER_LANGUAGES: Record<string, string> = {
  es: "spanish", en: "english", ca: "catalan", fr: "french", de: "german", it: "italian", pt: "portuguese",
};

type AsrPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
interface TransformersModule {
  pipeline(task: string, model: string, options: Record<string, unknown>): Promise<AsrPipeline>;
}

export interface WhisperOptions {
  /** Model id; by default small, or tiny on slow computers (chooseWhisperSize). */
  model: string;
  transformersUrl: string;
}

export class WhisperListener implements Listener {
  readonly name = "local Whisper";
  private o: WhisperOptions;
  private model: Promise<AsrPipeline> | null = null;
  private loaded = false;
  private stopNow: (() => void) | null = null;
  private finishNow: (() => void) | null = null;

  constructor(options: Partial<WhisperOptions> = {}) {
    this.o = { model: WHISPER_MODELS[whisperSizeHere()], transformersUrl: TRANSFORMERS_URL, ...options };
  }

  get ready(): boolean {
    return this.loaded;
  }

  get modelName(): string {
    return this.o.model.split("/").pop() ?? this.o.model;
  }

  available(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  }

  /**
   * Loads the model in advance (call it when the app opens, so the first question doesn't wait);
   * it is also loaded on first use. Downloaded once, then kept in the browser's cache.
   */
  preload(onStatus?: (text: string) => void): Promise<AsrPipeline> {
    this.model ??= (async () => {
      const tf = (await import(/* @vite-ignore */ `${this.o.transformersUrl}`)) as TransformersModule;
      // Several files download at once: show the overall progress.
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) [loaded, total] = [loaded + f.loaded, total + f.total];
        onStatus?.(`Preparing the voice (${this.modelName})… ${Math.round((100 * loaded) / total)} %`);
      };
      const load = (device: string, dtype: unknown) =>
        tf.pipeline("automatic-speech-recognition", this.o.model, { device, dtype, progress_callback });
      const { device, dtype } = await whisperDevice();
      let asr: AsrPipeline;
      try {
        asr = await load(device, dtype);
      } catch (err) {
        if (device === "wasm") throw err;
        asr = await load("wasm", "q8"); // the GPU path failed: the CPU always works
      }
      this.loaded = true;
      onStatus?.("Voice ready.");
      return asr;
    })();
    this.model.catch(() => (this.model = null));
    return this.model;
  }

  async listen(o: ListenOptions): Promise<string> {
    const modelPromise = this.preload(o.onStatus);
    const recorded = await this.record(o);
    if (!recorded) return "";
    const audio = await resampleTo16kHQ(recorded.samples, recorded.rate);
    o.onPartial?.("…");
    const asr = await modelPromise;
    const base = o.lang.split("-")[0].toLowerCase();
    const out = await asr(audio, { language: WHISPER_LANGUAGES[base] ?? "english", task: "transcribe" });
    const text = Array.isArray(out) ? out.map((x) => x.text).join(" ") : out.text;
    return text.trim();
  }

  /** Records one phrase: waits for speech, stops after a silence. null if nobody spoke. */
  private async record(o: ListenOptions): Promise<{ samples: Float32Array; rate: number } | null> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const vad = new EnergyVad();
    const preRoll: Float32Array[] = [];
    const chunks: Float32Array[] = [];
    const frameMs = (2048 / ctx.sampleRate) * 1000;
    let started = false;

    try {
      return await new Promise<{ samples: Float32Array; rate: number } | null>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(startTimer);
          clearTimeout(maxTimer);
          this.stopNow = null;
          this.finishNow = null;
          if (!ok || chunks.length === 0) return resolve(null);
          const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) {
            all.set(c, at);
            at += c.length;
          }
          resolve({ samples: all, rate: ctx.sampleRate });
        };
        const startTimer = setTimeout(() => !started && finish(false), o.startTimeoutMs ?? 6000);
        const maxTimer = setTimeout(() => finish(started), o.maxMs ?? 12000);
        this.stopNow = () => finish(false);
        this.finishNow = () => finish(started);
        proc.onaudioprocess = (e) => {
          const frame = new Float32Array(e.inputBuffer.getChannelData(0));
          const ev = vad.feed(frame, frameMs);
          if (!started) {
            // Keep ~300 ms before the start so the first syllable isn't lost.
            preRoll.push(frame);
            while (preRoll.length * frameMs > 300) preRoll.shift();
            if (ev === "start") {
              started = true;
              chunks.push(...preRoll);
              o.onPartial?.("🎙️");
            }
            return;
          }
          chunks.push(frame);
          if (ev === "end") finish(true);
        };
        source.connect(proc);
        proc.connect(ctx.destination);
      });
    } finally {
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    }
  }

  finish(): void {
    this.finishNow?.();
  }

  cancel(): void {
    this.stopNow?.();
  }
}

// ---------------------------------------------------------------------------------------------
// Automatic choice

export interface AutoListenerOptions {
  /** Skip the browser recognizer (default: inside the desktop app). */
  preferLocal: boolean;
  /**
   * Local Whisper first (docs/VOZ.md: whisper-small is exact in Spanish). While its model is
   * still downloading, the browser recognizer answers instead, so nobody waits. Default true.
   */
  localFirst: boolean;
  /** An empty result faster than this means the browser recognizer isn't really working. */
  suspiciousMs: number;
  now: () => number;
}

export class AutoListener implements Listener {
  private web: Listener;
  private local: Listener;
  private webBroken: boolean;
  private active: Listener | null = null;
  private o: AutoListenerOptions;

  constructor(
    web: Listener = new WebSpeechListener(),
    local: Listener = new WhisperListener(),
    options: Partial<AutoListenerOptions> = {},
  ) {
    this.web = web;
    this.local = local;
    this.o = { preferLocal: isDesktopWebview(), localFirst: true, suspiciousMs: 700, now: () => Date.now(), ...options };
    this.webBroken = this.o.preferLocal;
  }

  get name(): string {
    return this.useLocalNow() || !this.useWeb() ? this.local.name : this.web.name;
  }

  /** Starts downloading the local model now (when the app opens). */
  preload(onStatus?: (text: string) => void): Promise<unknown> {
    const local = this.local as Listener & { preload?: (onStatus?: (text: string) => void) => Promise<unknown> };
    return local.preload?.(onStatus) ?? Promise.resolve();
  }

  /** Local first, if it can answer now (or if there is nothing else to use). */
  private useLocalNow(): boolean {
    if (!this.o.localFirst || !this.local.available()) return false;
    return (this.local.ready ?? true) || !this.useWeb();
  }

  available(): boolean {
    return this.web.available() || this.local.available();
  }

  private useWeb(): boolean {
    return !this.webBroken && this.web.available();
  }

  async listen(o: ListenOptions): Promise<string> {
    if (this.useLocalNow()) {
      this.active = this.local;
      try {
        return await this.local.listen(o);
      } catch (localError) {
        // The model couldn't load (e.g. no network) or the recording failed: try the browser.
        if (!this.useWeb()) throw localError;
        o.onStatus?.("Switching to the browser's speech recognition…");
        this.active = this.web;
        return this.web.listen(o);
      }
    }
    if (this.useWeb()) {
      const started = this.o.now();
      let webError: unknown = null;
      try {
        this.active = this.web;
        const text = await this.web.listen(o);
        // A real recognizer waits several seconds for speech; ending at once with nothing means
        // the API exists but doesn't work (seen in embedded webviews).
        if (text || this.o.now() - started >= this.o.suspiciousMs) return text;
      } catch (err) {
        if (err instanceof ListenError && NOTHING_SAID.has(err.code)) return "";
        webError = err;
      }
      // Try on-device recognition before giving up. If it works, keep using it from now on.
      o.onStatus?.("Switching to on-device speech recognition…");
      this.active = this.local;
      try {
        const text = await this.local.listen(o);
        this.webBroken = true;
        return text;
      } catch (localError) {
        throw webError ?? localError;
      }
    }
    this.active = this.local;
    return this.local.listen(o);
  }

  finish(): void {
    this.active?.finish();
  }

  cancel(): void {
    this.active?.cancel();
  }
}
