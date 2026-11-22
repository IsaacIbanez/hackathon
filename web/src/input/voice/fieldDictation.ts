// Filling in one form field by voice, in turns: listen → apply → read back letter by letter →
// listen again. Nothing is saved and nothing moves on until the user confirms ("sí" or 👍).

import type { Earcon } from "./earcons.ts";
import type { Listener } from "./listener.ts";
import { applyEdit, interpretDictation, spellOut, type DictationEdit } from "./spelling.ts";

/** The parts of the Speaker the dictation needs. */
export interface DictationSpeech {
  readonly isSpeaking: boolean;
  speak(p: { text: string; lang?: string }): void;
  stop(): void;
  onSpeakingChange(listener: (speaking: boolean) => void): () => void;
}

export type DictationPhase = "idle" | "listening" | "speaking" | "paused" | "confirmed" | "cancelled";

export interface DictationState {
  phase: DictationPhase;
  /** Field being filled ("Nombre y apellidos"), if known. */
  label: string | null;
  /** Draft value (not saved until confirmed). */
  value: string;
  /** Last thing the recognizer heard (live while listening). */
  heard: string;
  /** What the app just said or is about to do, for the screen. */
  message: string;
  /** Whether there is a previous value to undo to. */
  canUndo: boolean;
}

export interface FieldDictationOptions {
  lang: string;
  listener: Listener;
  speaker?: DictationSpeech;
  beep?: (kind: Earcon) => void;
  onState?: (state: DictationState) => void;
  /**
   * Called once, when the user confirms the value. It may return a sentence to say after
   * "Saved" (e.g. which field comes next); the next field never starts on its own.
   */
  onConfirm?: (value: string, label: string | null) => string | void;
  /** Turns without speech before pausing (the user resumes by pointing again or with a button). */
  maxSilentTurns: number;
}

const TEXTS = {
  es: {
    start: (label: string | null) =>
      `${label ? `Vamos con: ${label}. ` : ""}Dímelo, o deletréalo letra a letra. Cuando esté bien, di «sí».`,
    resume: "Sigo escuchando.",
    current: (v: string, spelled: string) => `Llevo: ${v}. Se escribe: ${spelled}. ¿Está bien?`,
    empty: "El campo está vacío. Dímelo o deletréalo.",
    reject: "Vale. Dímelo otra vez, deletréalo, o di «borra la última letra».",
    unclear: "No te he entendido. Dímelo otra vez o deletréalo.",
    silent: "No te oigo. Lo dejo en pausa; vuelve a señalar el campo o pulsa «Seguir».",
    saved: (v: string) => `Guardado: ${v}.`,
    cancelled: "Cancelado. No he guardado nada.",
    undone: (v: string) => (v ? `He deshecho el último cambio. Llevo: ${v}.` : "He deshecho el último cambio. El campo está vacío."),
    nothingToSave: "Aún no hay nada que guardar.",
  },
  en: {
    start: (label: string | null) =>
      `${label ? `Next: ${label}. ` : ""}Say it, or spell it letter by letter. When it's right, say "yes".`,
    resume: "I'm listening again.",
    current: (v: string, spelled: string) => `So far: ${v}. Spelled: ${spelled}. Is that right?`,
    empty: "The field is empty. Say it or spell it.",
    reject: "OK. Say it again, spell it, or say \"delete last letter\".",
    unclear: "I didn't understand. Say it again or spell it.",
    silent: "I can't hear you. I'll pause; point at the field again or press \"Continue\".",
    saved: (v: string) => `Saved: ${v}.`,
    cancelled: "Cancelled. Nothing was saved.",
    undone: (v: string) => (v ? `Undone. So far: ${v}.` : "Undone. The field is empty."),
    nothingToSave: "There's nothing to save yet.",
  },
};

export class FieldDictation {
  private o: FieldDictationOptions;
  private s: DictationState = { phase: "idle", label: null, value: "", heard: "", message: "", canUndo: false };
  private history: string[] = [];
  /** Bumped on every start/stop, so an old loop ends when a new one begins. */
  private run = 0;

  constructor(options: Partial<FieldDictationOptions> & Pick<FieldDictationOptions, "lang" | "listener">) {
    this.o = { maxSilentTurns: 2, ...options };
  }

  get state(): Readonly<DictationState> {
    return this.s;
  }

  /** Whether a field is being filled (listening, speaking or paused). */
  get active(): boolean {
    return this.s.phase === "listening" || this.s.phase === "speaking" || this.s.phase === "paused";
  }

  /** Starts filling a field (or resumes the paused one if no new field is given). */
  start(label: string | null = null, initial = ""): void {
    const resuming = this.s.phase === "paused" && label === null;
    if (!resuming) {
      this.history = [];
      this.update({ label, value: initial, heard: "", canUndo: false });
    }
    void this.loop(resuming ? this.t.resume : this.t.start(label));
  }

  /** 👍 or "Save" button: saves the draft. */
  confirm(): void {
    if (!this.active) return;
    const value = this.s.value.trim();
    if (!value) {
      void this.loop(this.t.nothingToSave);
      return;
    }
    const label = this.s.label;
    this.update({ value });
    const extra = this.o.onConfirm?.(value, label);
    this.o.beep?.("end");
    this.end("confirmed", extra ? `${this.t.saved(value)} ${extra}` : this.t.saved(value));
  }

  /** 👎 or "Undo" button: back to the value before the last change. */
  undo(): void {
    if (!this.active || this.history.length === 0) return;
    const previous = this.history.pop()!;
    this.update({ value: previous, canUndo: this.history.length > 0 });
    void this.loop(this.t.undone(previous));
  }

  /** ✋ while listening: the user has finished talking (useful in noisy rooms). */
  finishListening(): void {
    if (this.s.phase === "listening") this.o.listener.finish();
  }

  /** Leaves the field without saving. */
  cancel(): void {
    if (!this.active) return;
    this.end("cancelled", this.t.cancelled);
  }

  private get t() {
    return TEXTS[this.o.lang.split("-")[0].toLowerCase() as keyof typeof TEXTS] ?? TEXTS.en;
  }

  private end(phase: "confirmed" | "cancelled", message: string): void {
    this.run++;
    this.o.listener.cancel();
    this.update({ phase, message, heard: "" });
    this.say(message, this.run);
  }

  /** Says something, then keeps listening and applying edits until confirm, cancel or silence. */
  private async loop(firstMessage: string): Promise<void> {
    const run = ++this.run;
    this.o.listener.cancel();
    let message = firstMessage;
    let silent = 0;
    while (run === this.run) {
      this.update({ phase: "speaking", message });
      await this.say(message, run);
      if (run !== this.run) return;

      this.update({ phase: "listening", heard: "" });
      this.o.beep?.("start");
      let text = "";
      try {
        text = await this.o.listener.listen({
          lang: this.o.lang,
          maxMs: 15000,
          onPartial: (t) => run === this.run && this.update({ heard: t }),
        });
      } catch {
        if (run !== this.run) return;
        this.o.beep?.("error");
        message = this.t.unclear;
        continue;
      }
      if (run !== this.run) return;
      this.o.beep?.("end");

      if (!text.trim()) {
        silent++;
        if (silent >= this.o.maxSilentTurns) {
          this.update({ phase: "paused", message: this.t.silent });
          await this.say(this.t.silent, run);
          return;
        }
        message = this.s.value ? this.t.current(this.s.value, spellOut(this.s.value, this.o.lang)) : this.t.empty;
        continue;
      }
      silent = 0;
      this.update({ heard: text });
      const edit = interpretDictation(text, this.o.lang);
      const next = this.handle(edit);
      if (next === null) return; // confirmed or cancelled
      message = next;
    }
  }

  /** Applies an edit and returns what to say next, or null if the dictation ended. */
  private handle(edit: DictationEdit | null): string | null {
    const t = this.t;
    if (!edit) return t.unclear;
    switch (edit.kind) {
      case "confirm":
        if (!this.s.value.trim()) return t.nothingToSave;
        this.confirm();
        return null;
      case "cancel":
        this.cancel();
        return null;
      case "reject":
        return t.reject;
      case "readback":
        return this.s.value ? t.current(this.s.value, spellOut(this.s.value, this.o.lang)) : t.empty;
      default: {
        const value = applyEdit(this.s.value, edit);
        if (value !== this.s.value) {
          this.history.push(this.s.value);
          this.update({ value, canUndo: true });
        }
        return value ? t.current(value.trim(), spellOut(value.trim(), this.o.lang)) : t.empty;
      }
    }
  }

  /** Speaks and waits until it has finished (or a newer run took over). */
  private say(text: string, run: number): Promise<void> {
    const sp = this.o.speaker;
    if (!sp) return Promise.resolve();
    return new Promise((resolve) => {
      let started = false;
      const done = () => {
        off();
        clearTimeout(guard);
        clearInterval(poll);
        resolve();
      };
      const off = sp.onSpeakingChange((speaking) => {
        if (speaking) started = true;
        else if (started) done();
      });
      // Safety nets: speech that never starts, or a newer run that replaced this one.
      const guard = setTimeout(done, 2500 + text.length * 90);
      const poll = setInterval(() => run !== this.run && done(), 100);
      sp.speak({ text, lang: this.o.lang });
      // No speech synthesis available: nothing to wait for (the text is on screen).
      if (sp.isSpeaking) started = true;
      else done();
    });
  }

  private update(patch: Partial<DictationState>): void {
    this.s = { ...this.s, ...patch };
    this.o.onState?.(this.s);
  }
}
