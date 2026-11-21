// Text helpers for speech: splitting into sentences and normalizing what the user said.

/**
 * Splits text into sentences so speech can pause and resume between them (and so long texts are
 * not cut off: Chrome stops speaking a single utterance after ~15 s).
 */
export function splitSentences(text: string, maxLength = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?¡¿…;:]+[.!?…;:]*["»”)]*\s*|[¡¿][^.!?…]+[.!?…]*\s*/g) ?? [clean];
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    // Very long sentences (lists, legal text) are cut at commas, then at spaces.
    if (s.length <= maxLength) {
      out.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > maxLength) {
      // Cut after a comma or a space, keeping the piece within maxLength.
      const window = rest.slice(0, maxLength);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const at = cut > maxLength / 3 ? cut + 1 : maxLength;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/** Lowercase, without accents or punctuation: "¡Léeme!" → "leeme". */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
