import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, normalizeSpeech } from "../voice/text.ts";
import { parseCommand } from "../voice/commands.ts";
import { EnergyVad, resampleTo16k } from "../voice/vad.ts";
import { Speaker, chooseVoice, type SynthLike, type UtteranceLike, type VoiceLike } from "../voice/speaker.ts";
import { AutoListener, ListenError, type Listener, type ListenOptions } from "../voice/listener.ts";
import { VoiceInput } from "../voice/voiceInput.ts";
import type { ClientMessage } from "../../api/index.ts";

// ---- Text ----

test("splitSentences splits on sentence ends and cuts very long sentences", () => {
  assert.deepEqual(splitSentences("Hola. ¿Qué tal?  Bien!"), ["Hola.", "¿Qué tal?", "Bien!"]);
  assert.deepEqual(splitSentences("   "), []);
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(", ") + ".";
  const parts = splitSentences(long, 100);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 100), JSON.stringify(parts));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
});

test("normalizeSpeech removes accents, case and punctuation", () => {
  assert.equal(normalizeSpeech("¡Léeme  el Documento!"), "leeme el documento");
});

// ---- Commands ----

test("short phrases are local commands in Spanish and English; questions are not", () => {
  assert.equal(parseCommand("Para, por favor", "es-ES"), "pause");
  assert.equal(parseCommand("¡Más alto!", "es-ES"), "louder");
  assert.equal(parseCommand("repite", "es"), "repeat");
  assert.equal(parseCommand("continue", "es-ES"), "resume"); // English always works
  assert.equal(parseCommand("Stop", "en-US"), "pause");
  assert.equal(parseCommand("¿Qué significa franquicia?", "es-ES"), null);
  assert.equal(parseCommand("Where do I have to sign?", "en-US"), null);
  assert.equal(parseCommand("", "en"), null);
});

// ---- Voice activity detection ----

const tone = (amp: number, n = 800) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 3));

test("the VAD starts after sustained speech and ends after a silence", () => {
  const vad = new EnergyVad();
  const events: string[] = [];
  const feed = (amp: number, frames: number) => {
    for (let i = 0; i < frames; i++) {
      const e = vad.feed(tone(amp), 50);
      if (e) events.push(e);
    }
  };
  feed(0.002, 20); // background noise
  feed(0.2, 1); // a click: too short
  feed(0.002, 5);
  assert.deepEqual(events, []);
  feed(0.2, 10); // speech
  assert.deepEqual(events, ["start"]);
  feed(0.002, 25); // silence > 900 ms
  assert.deepEqual(events, ["start", "end"]);
});

test("resampleTo16k keeps the duration", () => {
  assert.equal(resampleTo16k(new Float32Array(48000), 48000).length, 16000);
  const same = new Float32Array(10);
  assert.equal(resampleTo16k(same, 16000), same);
});

// ---- Speaker ----

class FakeSynth implements SynthLike {
  spoken: string[] = [];
  current: UtteranceLike | null = null;
  voices: VoiceLike[] = [];
  speak(u: UtteranceLike) {
    this.spoken.push(`${u.text}@${u.volume.toFixed(1)}`);
    this.current = u;
  }
  cancel() {
    this.current = null;
  }
  getVoices() {
    return this.voices;
  }
  /** The browser finishes the current sentence. */
  finish() {
    const u = this.current;
    this.current = null;
    u?.onend?.();
  }
}

const makeUtterance = (text: string): UtteranceLike => ({
  text, lang: "", volume: 1, rate: 1, voice: null, onend: null, onerror: null,
});

test("the speaker reads sentence by sentence; pause and resume continue from the same sentence", () => {
  const synth = new FakeSynth();
  const sp = new Speaker({ synth, makeUtterance });
  const changes: boolean[] = [];
  sp.onSpeakingChange((v) => changes.push(v));
  sp.speak({ text: "One. Two. Three.", lang: "en-US" });
  synth.finish(); // "One." done
  sp.pause();
  assert.equal(sp.isPaused, true);
  sp.resume(); // "Two." again
  synth.finish();
  synth.finish();
  assert.deepEqual(synth.spoken, ["One.@1.0", "Two.@1.0", "Two.@1.0", "Three.@1.0"]);
  assert.equal(sp.isSpeaking, false);
  assert.deepEqual(changes, [true, false, true, false]);
});

test("repeat says the last sentence again; volume applies immediately", () => {
  const synth = new FakeSynth();
  const sp = new Speaker({ synth, makeUtterance });
  sp.speak({ text: "First. Last.", lang: "es-ES" });
  synth.finish();
  synth.finish();
  sp.repeat();
  sp.setVolume(0.4); // restarts the current sentence at the new volume
  assert.deepEqual(synth.spoken.slice(-2), ["Last.@1.0", "Last.@0.4"]);
});

test("chooseVoice prefers the exact language and natural voices", () => {
  const voices: VoiceLike[] = [
    { name: "English", lang: "en-US" },
    { name: "Spanish (Mexico)", lang: "es-MX" },
    { name: "Microsoft Elvira Online (Natural) - Spanish (Spain)", lang: "es-ES" },
    { name: "Basic Spanish", lang: "es-ES" },
  ];
  assert.equal(chooseVoice(voices, "es-ES")?.name, "Microsoft Elvira Online (Natural) - Spanish (Spain)");
  assert.equal(chooseVoice(voices, "es-AR")?.name, "Microsoft Elvira Online (Natural) - Spanish (Spain)");
  assert.equal(chooseVoice(voices, "fr-FR"), null);
});

// ---- Listening ----

class FakeListener implements Listener {
  readonly name: string;
  private readonly reply: () => Promise<string>;
  private readonly ok: boolean;
  constructor(name: string, reply: () => Promise<string>, ok = true) {
    this.name = name;
    this.reply = reply;
    this.ok = ok;
  }
  available() {
    return this.ok;
  }
  listen(o: ListenOptions) {
    o.onPartial?.("…");
    return this.reply();
  }
  cancel() {}
}

test("AutoListener switches to the local recognizer for good when the browser one can't work", async () => {
  let webCalls = 0;
  const web = new FakeListener("web", async () => {
    webCalls++;
    throw new ListenError("network");
  });
  const local = new FakeListener("local", async () => "hola");
  const auto = new AutoListener(web, local);
  assert.equal(await auto.listen({ lang: "es-ES" }), "hola");
  assert.equal(await auto.listen({ lang: "es-ES" }), "hola");
  assert.equal(webCalls, 1);
  assert.equal(auto.name, "local");
});

test("AutoListener doesn't hide real errors such as a denied microphone", async () => {
  const web = new FakeListener("web", async () => {
    throw new ListenError("not-allowed");
  });
  const auto = new AutoListener(web, new FakeListener("local", async () => "x"));
  await assert.rejects(auto.listen({ lang: "en" }), /not-allowed/);
});

// ---- Voice questions ----

function setup(reply: string | Error) {
  const synth = new FakeSynth();
  const speaker = new Speaker({ synth, makeUtterance });
  const sent: ClientMessage[] = [];
  const beeps: string[] = [];
  const listener = new FakeListener("fake", async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const voice = new VoiceInput({ lang: "es-ES", listener, speaker, send: (m) => sent.push(m), beep: (k) => beeps.push(k) });
  return { synth, speaker, sent, beeps, voice };
}

test("a spoken question is sent to Go as an utterance and stops the current reading", async () => {
  const { speaker, sent, beeps, voice } = setup("¿Qué significa franquicia?");
  speaker.speak({ text: "Una. Dos.", lang: "es-ES" });
  const r = await voice.ask();
  assert.equal(r?.sent, "¿Qué significa franquicia?");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "utterance");
  assert.deepEqual(sent[0].payload, { text: "¿Qué significa franquicia?", isFinal: true, lang: "es-ES" });
  assert.deepEqual(beeps, ["start", "end"]);
  assert.equal(speaker.isSpeaking, false);
});

test("a spoken command runs locally: nothing goes to Go", async () => {
  const { speaker, sent, synth, voice } = setup("repite");
  speaker.speak({ text: "Una. Dos.", lang: "es-ES" });
  synth.finish(); // now reading "Dos."
  const r = await voice.ask();
  assert.equal(r?.command, "repeat");
  assert.equal(sent.length, 0);
  assert.equal(synth.spoken.at(-1), "Dos.@1.0");
});

test("pointing and saying nothing sends the default question", async () => {
  const { sent, voice } = setup("");
  const r = await voice.ask({ fallbackQuestion: "¿Qué pone aquí?" });
  assert.equal(r?.sent, "¿Qué pone aquí?");
  assert.equal(sent.length, 1);
});

test("if listening fails, reading resumes and an error beep sounds", async () => {
  const { speaker, beeps, voice } = setup(new ListenError("audio-capture"));
  speaker.speak({ text: "Una. Dos.", lang: "es-ES" });
  const r = await voice.ask();
  assert.equal(r, null);
  assert.equal(speaker.isSpeaking, true);
  assert.deepEqual(beeps, ["start", "error"]);
});
