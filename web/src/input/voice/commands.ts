// Short spoken commands handled locally, without any model (frugal and instant).
// Anything that isn't one of these is a question and goes to Go as an utterance.

import { normalizeSpeech } from "./text.ts";

export type VoiceCommand = "pause" | "resume" | "repeat" | "louder" | "quieter";

/** Phrases per language, already normalized (lowercase, no accents or punctuation). */
const PHRASES: Record<string, Record<VoiceCommand, string[]>> = {
  en: {
    pause: ["stop", "pause", "quiet", "be quiet", "silence", "shut up", "wait"],
    resume: ["continue", "resume", "go on", "carry on", "keep going"],
    repeat: ["repeat", "again", "say it again", "repeat that", "what", "sorry", "pardon"],
    louder: ["louder", "volume up", "speak up", "turn it up", "more volume"],
    quieter: ["quieter", "softer", "volume down", "turn it down", "less volume", "lower"],
  },
  es: {
    pause: ["para", "parar", "pausa", "calla", "callate", "silencio", "stop", "espera"],
    resume: ["sigue", "seguir", "continua", "continuar", "adelante"],
    repeat: ["repite", "repitelo", "repetir", "otra vez", "que", "como", "perdon"],
    louder: ["mas alto", "sube", "sube el volumen", "mas volumen", "habla mas alto"],
    quieter: ["mas bajo", "baja", "baja el volumen", "menos volumen", "habla mas bajo"],
  },
};

/**
 * Returns the command if the whole utterance is a known command phrase (optionally with "please"
 * / "por favor"), or null if it's a question for the assistant.
 */
export function parseCommand(text: string, lang: string): VoiceCommand | null {
  let t = normalizeSpeech(text);
  t = t.replace(/\b(please|por favor|porfa)\b/g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const base = lang.split("-")[0].toLowerCase();
  // The user's language first; English always works too.
  for (const l of [base, "en"]) {
    const table = PHRASES[l];
    if (!table) continue;
    for (const [cmd, phrases] of Object.entries(table) as [VoiceCommand, string[]][]) {
      if (phrases.includes(t)) return cmd;
    }
  }
  return null;
}
