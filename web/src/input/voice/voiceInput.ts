// Voice questions: when the user asks (a gesture), pause the assistant's speech, beep, listen to
// one phrase and then either run a local command ("stop", "repeat", "louder"…) or send the
// question to Go as an utterance (api/openapi.yaml). Pure logic with injected parts, so it is
// tested without a browser.

import type { ClientMessage } from "../../api/index.ts";
import { parseCommand, type VoiceCommand } from "./commands.ts";
import type { Earcon } from "./earcons.ts";
import type { Listener } from "./listener.ts";

/** The parts of the Speaker that voice questions need. */
export interface SpeechOutput {
  readonly isSpeaking: boolean;
  readonly isPaused: boolean;
  readonly volume: number;
  pause(): void;
  resume(): void;
  repeat(): void;
  stop(): void;
  setVolume(v: number): void;
}

export type VoicePhase = "idle" | "listening" | "heard" | "error";

export interface VoiceState {
  phase: VoicePhase;
  /** Partial or final transcript, or a status / error message. */
  text: string;
}

export interface VoiceInputOptions {
  lang: string;
  listener: Listener;
  speaker?: SpeechOutput;
  /** Sends the question to Go. */
  send?: (msg: ClientMessage) => void;
  beep?: (kind: Earcon) => void;
  onState?: (state: VoiceState) => void;
  maxMs?: number;
}

export interface AskResult {
  text: string;
  command: VoiceCommand | null;
  /** The utterance sent to Go, if any. */
  sent: string | null;
}

/** Default question when the user points and holds but says nothing. */
export const DEFAULT_QUESTION: Record<string, string> = {
  es: "¿Qué pone aquí y qué tengo que hacer?",
  en: "What does this say and what do I have to do?",
};

const NOTHING_HEARD: Record<string, string> = { es: "No te he oído.", en: "I didn't hear anything." };
const ASKING_INSTEAD: Record<string, string> = { es: "Pregunto:", en: "Asking:" };

let counter = 0;
function newId(): string {
  counter += 1;
  return `utt-voice-${Date.now()}-${counter}`;
}

export class VoiceInput {
  private o: VoiceInputOptions;
  private busy = false;

  constructor(options: VoiceInputOptions) {
    this.o = options;
  }

  get listening(): boolean {
    return this.busy;
  }

  get available(): boolean {
    return this.o.listener.available();
  }

  setLang(lang: string): void {
    this.o.lang = lang;
  }

  /**
   * Listens to one phrase. If nothing is heard and `fallbackQuestion` is given, that question is
   * sent instead (e.g. "explain this" when the user points and holds without speaking).
   */
  async ask(options: { fallbackQuestion?: string } = {}): Promise<AskResult | null> {
    if (this.busy) return null;
    this.busy = true;
    const sp = this.o.speaker;
    const wasSpeaking = !!sp?.isSpeaking;
    if (wasSpeaking) sp!.pause();
    const base = this.o.lang.split("-")[0].toLowerCase();
    try {
      this.o.beep?.("start");
      this.state("listening", "");
      const text = await this.o.listener.listen({
        lang: this.o.lang,
        maxMs: this.o.maxMs,
        onPartial: (t) => this.state("listening", t),
        onStatus: (t) => this.state("listening", t),
      });
      this.o.beep?.("end");

      if (!text) {
        if (options.fallbackQuestion) {
          this.sendUtterance(options.fallbackQuestion);
          sp?.stop();
          // Say so clearly: the default question was not something the user said.
          const nothing = NOTHING_HEARD[base] ?? NOTHING_HEARD.en;
          const asking = ASKING_INSTEAD[base] ?? ASKING_INSTEAD.en;
          this.state("heard", `${nothing} ${asking} «${options.fallbackQuestion}»`);
          return { text: "", command: null, sent: options.fallbackQuestion };
        }
        if (wasSpeaking) sp!.resume();
        this.state("idle", NOTHING_HEARD[base] ?? NOTHING_HEARD.en);
        return { text: "", command: null, sent: null };
      }

      const command = parseCommand(text, this.o.lang);
      if (command) {
        this.run(command, wasSpeaking);
        this.state("heard", text);
        return { text, command, sent: null };
      }
      // A real question: the answer will replace what was being read.
      this.sendUtterance(text);
      sp?.stop();
      this.state("heard", text);
      return { text, command: null, sent: text };
    } catch (err) {
      this.o.beep?.("error");
      if (wasSpeaking) sp!.resume();
      this.state("error", err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** The user says they're done talking (e.g. open palm): use what was heard so far. */
  finish(): void {
    this.o.listener.finish();
  }

  cancel(): void {
    this.o.listener.cancel();
  }

  private run(command: VoiceCommand, wasSpeaking: boolean): void {
    const sp = this.o.speaker;
    if (!sp) return;
    switch (command) {
      case "pause":
        break; // already paused while listening
      case "resume":
        sp.resume();
        break;
      case "repeat":
        sp.repeat();
        break;
      case "louder":
      case "quieter":
        sp.setVolume(sp.volume + (command === "louder" ? 0.2 : -0.2));
        if (wasSpeaking) sp.resume();
        break;
    }
  }

  private sendUtterance(text: string): void {
    this.o.send?.({ type: "utterance", id: newId(), ts: Date.now(), payload: { text, isFinal: true, lang: this.o.lang } });
  }

  private state(phase: VoicePhase, text: string): void {
    this.o.onState?.({ phase, text });
  }
}
