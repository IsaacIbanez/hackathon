// Speech recognition, push-to-talk (only while the user asks, never always-on):
// - WebSpeechListener: the browser's recognizer (Chrome, Edge). Fast, but sends audio to the
//   browser vendor's servers and is missing in embedded webviews (Wails: WebView2, WebKitGTK).
// - WhisperListener: Whisper running locally in the page (transformers.js, WASM). Works in any
//   modern webview and the audio never leaves the computer. The model (~40 MB) downloads once.
// - AutoListener: inside the desktop app (Wails) goes straight to Whisper; in a browser it tries
//   the browser recognizer first and switches to Whisper for good if it doesn't really work.

import { EnergyVad, resampleTo16k } from "./vad.ts";

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
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.current = null;
        fn();
      };
      const timer = setTimeout(() => r.stop(), o.maxMs ?? 12000);
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        o.onPartial?.((final + interim).trim());
      };
      r.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") done(() => resolve(final.trim()));
        else done(() => reject(new ListenError(e.error)));
      };
      r.onend = () => done(() => resolve(final.trim()));
      try {
        r.start();
      } catch (err) {
        done(() => reject(new ListenError("unsupported", String(err))));
      }
    });
  }

  cancel(): void {
    this.current?.abort();
  }
}

// ---------------------------------------------------------------------------------------------
// Local Whisper

export const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
export const WHISPER_MODEL = "onnx-community/whisper-tiny";

const WHISPER_LANGUAGES: Record<string, string> = {
  es: "spanish", en: "english", ca: "catalan", fr: "french", de: "german", it: "italian", pt: "portuguese",
};

type AsrPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
interface TransformersModule {
  pipeline(task: string, model: string, options: Record<string, unknown>): Promise<AsrPipeline>;
}

export interface WhisperOptions {
  model: string;
  transformersUrl: string;
}

export class WhisperListener implements Listener {
  readonly name = "local Whisper";
  private o: WhisperOptions;
  private model: Promise<AsrPipeline> | null = null;
  private stopNow: (() => void) | null = null;

  constructor(options: Partial<WhisperOptions> = {}) {
    this.o = { model: WHISPER_MODEL, transformersUrl: TRANSFORMERS_URL, ...options };
  }

  available(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  }

  /** Loads the model in advance (it is also loaded on first use). */
  preload(onStatus?: (text: string) => void): Promise<AsrPipeline> {
    this.model ??= (async () => {
      const tf = (await import(/* @vite-ignore */ `${this.o.transformersUrl}`)) as TransformersModule;
      return tf.pipeline("automatic-speech-recognition", this.o.model, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            onStatus?.(`Downloading the speech model… ${Math.round(p.progress)} %`);
          }
        },
      });
    })();
    this.model.catch(() => (this.model = null));
    return this.model;
  }

  async listen(o: ListenOptions): Promise<string> {
    const modelPromise = this.preload(o.onStatus);
    const audio = await this.record(o);
    if (!audio) return "";
    o.onPartial?.("…");
    const asr = await modelPromise;
    const base = o.lang.split("-")[0].toLowerCase();
    const out = await asr(audio, { language: WHISPER_LANGUAGES[base] ?? "english", task: "transcribe" });
    const text = Array.isArray(out) ? out.map((x) => x.text).join(" ") : out.text;
    return text.trim();
  }

  /** Records one phrase: waits for speech, stops after a silence. null if nobody spoke. */
  private async record(o: ListenOptions): Promise<Float32Array | null> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
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
      return await new Promise<Float32Array | null>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(startTimer);
          clearTimeout(maxTimer);
          this.stopNow = null;
          if (!ok || chunks.length === 0) return resolve(null);
          const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) {
            all.set(c, at);
            at += c.length;
          }
          resolve(resampleTo16k(all, ctx.sampleRate));
        };
        const startTimer = setTimeout(() => !started && finish(false), o.startTimeoutMs ?? 6000);
        const maxTimer = setTimeout(() => finish(started), o.maxMs ?? 12000);
        this.stopNow = () => finish(false);
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

  cancel(): void {
    this.stopNow?.();
  }
}

// ---------------------------------------------------------------------------------------------
// Automatic choice

export interface AutoListenerOptions {
  /** Skip the browser recognizer (default: inside the desktop app). */
  preferLocal: boolean;
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
    this.o = { preferLocal: isDesktopWebview(), suspiciousMs: 700, now: () => Date.now(), ...options };
    this.webBroken = this.o.preferLocal;
  }

  get name(): string {
    return this.useWeb() ? this.web.name : this.local.name;
  }

  available(): boolean {
    return this.web.available() || this.local.available();
  }

  private useWeb(): boolean {
    return !this.webBroken && this.web.available();
  }

  async listen(o: ListenOptions): Promise<string> {
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

  cancel(): void {
    this.active?.cancel();
  }
}
