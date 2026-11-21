// Spoken output (Web Speech API) for the assistant, sentence by sentence:
// - pause (✋) stops and resume (👍 / "continue") goes on from the same sentence;
// - repeat says the current (or last) sentence again;
// - long texts are not cut off (Chrome stops a single utterance after ~15 s);
// - it picks the best voice for the language and speaks a bit slower than default;
// - it reports when it is speaking, so the microphone can ignore the assistant's own voice.
//
// Drop-in replacement for web/src/app/voice.ts: it implements the bridge's VoiceControls
// (pause, repeat, setVolume) plus speak({ text, lang }).

import { splitSentences } from "./text.ts";

/** The parts of SpeechSynthesis we use (injected in tests). */
export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
}
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}
export interface UtteranceLike {
  text: string;
  lang: string;
  volume: number;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

export interface SpeakerOptions {
  /** Speech rate: 1 is the browser default; slightly slower is easier to follow. */
  rate: number;
  volume: number;
  synth?: SynthLike;
  makeUtterance?: (text: string) => UtteranceLike;
}

const DEFAULTS: SpeakerOptions = { rate: 0.95, volume: 1 };

/** Best voice for a language: exact match first, then same base language; natural voices first. */
export function chooseVoice(voices: VoiceLike[], lang: string): VoiceLike | null {
  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  const score = (v: VoiceLike) => {
    const l = v.lang.toLowerCase().replace("_", "-");
    let s = l === want ? 100 : l.split("-")[0] === base ? 50 : -1000;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 20;
    if (/google/i.test(v.name)) s += 10;
    if (v.default) s += 1;
    return s;
  };
  let best: VoiceLike | null = null;
  for (const v of voices) if (score(v) >= 0 && (!best || score(v) > score(best))) best = v;
  return best;
}

export class Speaker {
  private o: SpeakerOptions;
  private synth: SynthLike | null;
  private sentences: string[] = [];
  private index = 0;
  private lang = "es-ES";
  private playing = false;
  private paused = false;
  /** Increases on every new start so callbacks from cancelled utterances are ignored. */
  private run = 0;
  private listeners = new Set<(speaking: boolean) => void>();

  constructor(options: Partial<SpeakerOptions> = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.synth =
      this.o.synth ??
      (typeof window !== "undefined" && "speechSynthesis" in window
        ? (window.speechSynthesis as unknown as SynthLike)
        : null);
  }

  /** false when the platform has no speech synthesis. */
  get available(): boolean {
    return this.synth !== null;
  }

  get isSpeaking(): boolean {
    return this.playing;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Called with true when speech starts and false when it stops (pause, end or cancel). */
  onSpeakingChange(listener: (speaking: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Speaks a text, replacing whatever was being said. Accepts the contract's SpeakPayload. */
  speak(p: { text: string; lang?: string }): void {
    this.sentences = splitSentences(p.text);
    this.index = 0;
    if (p.lang) this.lang = p.lang;
    this.paused = false;
    this.start();
  }

  /** Stops speaking; resume() continues from the same sentence. */
  pause(): void {
    if (!this.playing) return;
    this.paused = true;
    this.halt();
  }

  resume(): void {
    if (!this.paused || this.index >= this.sentences.length) return;
    this.paused = false;
    this.start();
  }

  /** Says the current sentence again (or the last one, if it had finished). */
  repeat(): void {
    if (this.sentences.length === 0) return;
    if (this.index >= this.sentences.length) this.index = this.sentences.length - 1;
    this.paused = false;
    this.start();
  }

  /** Stops and forgets the text. */
  stop(): void {
    this.paused = false;
    this.sentences = [];
    this.index = 0;
    this.halt();
  }

  /** 0–1. Applied immediately: the current sentence restarts at the new volume. */
  setVolume(value: number): void {
    this.o.volume = Math.min(1, Math.max(0, value));
    if (this.playing) this.start();
  }

  get volume(): number {
    return this.o.volume;
  }

  setRate(rate: number): void {
    this.o.rate = Math.min(2, Math.max(0.5, rate));
  }

  private start(): void {
    if (!this.synth || this.index >= this.sentences.length) return;
    const run = ++this.run;
    this.synth.cancel();
    this.setPlaying(true);
    this.sayNext(run);
  }

  private sayNext(run: number): void {
    if (!this.synth || run !== this.run) return;
    if (this.index >= this.sentences.length) {
      this.setPlaying(false);
      return;
    }
    const u = this.makeUtterance(this.sentences[this.index]);
    u.lang = this.lang;
    u.volume = this.o.volume;
    u.rate = this.o.rate;
    u.voice = chooseVoice(this.synth.getVoices(), this.lang);
    u.onend = () => {
      if (run !== this.run) return;
      this.index++;
      this.sayNext(run);
    };
    u.onerror = (e) => {
      if (run !== this.run || e.error === "interrupted" || e.error === "canceled") return;
      this.index++;
      this.sayNext(run);
    };
    this.synth.speak(u);
  }

  private halt(): void {
    this.run++;
    this.synth?.cancel();
    this.setPlaying(false);
  }

  private makeUtterance(text: string): UtteranceLike {
    if (this.o.makeUtterance) return this.o.makeUtterance(text);
    return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
  }

  private setPlaying(v: boolean): void {
    if (this.playing === v) return;
    this.playing = v;
    for (const l of this.listeners) l(v);
  }
}
