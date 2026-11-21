// Dictating a form field by voice: free text, spelling letter by letter ("ene, i, ele",
// "N de Navarra"), corrections ("borra la última letra", "con tilde") and confirmation.
// Pure logic, no model: the value is only saved when the user confirms it.

export type DictationEdit =
  | { kind: "set"; value: string }
  /** spelled: letters continue the current word; otherwise the words are added after a space. */
  | { kind: "append"; value: string; spelled: boolean }
  | { kind: "backspace"; count: number }
  | { kind: "delete_word" }
  | { kind: "clear" }
  | { kind: "accent" }
  | { kind: "uppercase" }
  | { kind: "lowercase" }
  | { kind: "space" }
  | { kind: "readback" }
  | { kind: "confirm" }
  | { kind: "reject" }
  | { kind: "cancel" };

/** Lowercase, no punctuation, accents removed except ñ (it is its own letter). */
export function normalizeForSpelling(text: string): string {
  return text
    .toLowerCase()
    .replace(/ñ/g, "\uE000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\uE000/g, "ñ")
    .replace(/[¿?¡!,;:«»"“”()]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Vocabulary

/** Letter names (normalized). Multi-word names first so they win over their parts. */
const LETTERS: Record<string, Record<string, string>> = {
  es: {
    "uve doble": "w", "doble uve": "w", "doble ve": "w", "ve doble": "w",
    "i griega": "y", "y griega": "y",
    "be alta": "b", "be larga": "b", "be grande": "b", "be de barcelona": "b",
    "uve baja": "v", "ve baja": "v", "ve corta": "v", "ve chica": "v", "uve de valencia": "v",
    "doble ele": "ll", "doble erre": "rr",
    a: "a", be: "b", ce: "c", de: "d", e: "e", efe: "f", ge: "g", hache: "h", i: "i", jota: "j",
    ka: "k", ca: "k", ele: "l", eme: "m", ene: "n", "eñe": "ñ", enie: "ñ", o: "o", pe: "p", cu: "q",
    ere: "r", erre: "r", ese: "s", te: "t", u: "u", uve: "v", ve: "v", equis: "x", ye: "y",
    zeta: "z", ceta: "z", seta: "z",
    // "i" and "y" sound the same; recognizers write the spoken letter either way.
    y: "i",
  },
  en: {
    "double u": "w", "double you": "w",
    bee: "b", be: "b", see: "c", sea: "c", dee: "d", ef: "f", eff: "f", gee: "g", aitch: "h",
    jay: "j", kay: "k", el: "l", em: "m", en: "n", pee: "p", cue: "q", queue: "q", ar: "r",
    are: "r", es: "s", ess: "s", tee: "t", you: "u", vee: "v", ex: "x", why: "y", zed: "z", zee: "z",
  },
};

const DIGITS: Record<string, Record<string, string>> = {
  es: { cero: "0", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9" },
  en: { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" },
};

const SYMBOLS: Record<string, Record<string, string>> = {
  es: {
    "guion bajo": "_", "barra baja": "_", arroba: "@", punto: ".", guion: "-", barra: "/", espacio: " ",
    coma: ",", mas: "+",
  },
  en: { underscore: "_", at: "@", dot: ".", period: ".", dash: "-", hyphen: "-", slash: "/", space: " ", comma: ",", plus: "+" },
};

/** Whole-utterance commands (normalized). */
const COMMANDS: Record<string, [DictationEdit, string[]][]> = {
  es: [
    [{ kind: "confirm" }, ["si", "si esta bien", "esta bien", "correcto", "es correcto", "vale", "confirmar", "confirmo", "guardalo", "guardar", "perfecto", "eso es", "exacto", "ok"]],
    [{ kind: "reject" }, ["no", "no esta bien", "esta mal", "mal", "incorrecto", "no es eso"]],
    [{ kind: "cancel" }, ["cancelar", "cancela", "salir", "sal", "dejalo", "olvidalo"]],
    [{ kind: "clear" }, ["borra", "borralo", "borra todo", "borrar todo", "borrar", "empieza de nuevo", "otra vez desde el principio", "vacia"]],
    [{ kind: "backspace", count: 1 }, ["borra la ultima letra", "borra una letra", "borra la letra", "quita la ultima letra", "quita una letra", "atras"]],
    [{ kind: "backspace", count: 2 }, ["borra dos letras", "borra las dos ultimas letras", "quita dos letras"]],
    [{ kind: "backspace", count: 3 }, ["borra tres letras", "borra las tres ultimas letras", "quita tres letras"]],
    [{ kind: "delete_word" }, ["borra la ultima palabra", "borra la palabra", "quita la ultima palabra", "quita la palabra"]],
    [{ kind: "accent" }, ["con tilde", "con acento", "lleva tilde", "lleva acento", "ponle tilde", "ponle acento", "acento", "tilde"]],
    [{ kind: "uppercase" }, ["en mayusculas", "todo en mayusculas", "mayusculas"]],
    [{ kind: "lowercase" }, ["en minusculas", "todo en minusculas", "minusculas"]],
    [{ kind: "space" }, ["espacio", "un espacio", "pon un espacio"]],
    [{ kind: "readback" }, ["como esta", "que has puesto", "que pone", "leelo", "lee", "deletrealo", "deletrea", "repite", "repitelo", "como lo has escrito"]],
  ],
  en: [
    [{ kind: "confirm" }, ["yes", "yes thats right", "thats right", "correct", "right", "confirm", "save it", "save", "perfect", "ok", "okay"]],
    [{ kind: "reject" }, ["no", "wrong", "thats wrong", "not right", "incorrect"]],
    [{ kind: "cancel" }, ["cancel", "exit", "stop", "forget it"]],
    [{ kind: "clear" }, ["clear", "clear it", "delete", "delete all", "delete everything", "start again", "start over"]],
    [{ kind: "backspace", count: 1 }, ["delete last letter", "delete the last letter", "delete a letter", "backspace", "back"]],
    [{ kind: "delete_word" }, ["delete last word", "delete the last word"]],
    [{ kind: "accent" }, ["with an accent", "accent"]],
    [{ kind: "uppercase" }, ["uppercase", "all caps", "capitals", "in capitals"]],
    [{ kind: "lowercase" }, ["lowercase", "in lowercase"]],
    [{ kind: "space" }, ["space", "a space"]],
    [{ kind: "readback" }, ["read it", "read it back", "spell it", "what did you write", "repeat"]],
  ],
};

/** Phrases that introduce the value ("me llamo Nil" → "Nil"). Normalized; checked longest first. */
const VALUE_PREFIXES: Record<string, string[]> = {
  es: ["mi nombre es", "me llamo", "se escribe", "se llama", "escribe", "pon", "es", "son", "vivo en", "mi direccion es", "mi correo es", "mi telefono es", "mis apellidos son", "mi apellido es"],
  en: ["my name is", "it is", "its", "write", "put", "type", "my address is", "my email is", "my phone number is"],
};
/** Phrases that add to the value instead of replacing it ("añade Pérez"). */
const APPEND_PREFIXES: Record<string, string[]> = {
  es: ["añade", "anade", "y luego", "luego", "despues", "sigue con", "añadir", "agrega"],
  en: ["add", "then", "and then", "append"],
};
/** Words that explain a spelled letter: "N de Navarra", "be de Barcelona", "con hache". */
const EXAMPLE_WORDS: Record<string, string[]> = { es: ["de", "como", "como en"], en: ["as in", "for"] };

const ACCENTED: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };

// ---------------------------------------------------------------------------------------------
// Interpreting one utterance

function langOf(lang: string): string {
  const base = lang.split("-")[0].toLowerCase();
  return COMMANDS[base] ? base : "en";
}

/** Strips "please" and trailing politeness so "borra la última letra, por favor" is a command. */
function stripPolite(t: string): string {
  return t.replace(/\b(please|por favor|porfa|gracias|thanks)\b/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Tries to read the utterance as spelling. Returns the spelled text, or null if some word isn't
 * a letter, digit or symbol (then it's ordinary text).
 */
export function parseSpelling(text: string, lang: string): string | null {
  const l = langOf(lang);
  const letters = LETTERS[l];
  const words = normalizeForSpelling(text).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const names = Object.keys(letters).sort((a, b) => b.split(" ").length - a.split(" ").length);
  const symbols = SYMBOLS[l];
  const symbolNames = Object.keys(symbols).sort((a, b) => b.split(" ").length - a.split(" ").length);
  const digits = DIGITS[l];
  const examples = EXAMPLE_WORDS[l] ?? [];
  const startsWith = (phrase: string, at: number) => {
    const parts = phrase.split(" ");
    return parts.every((p, k) => words[at + k] === p) ? parts.length : 0;
  };

  let out = "";
  let upperNext = false;
  let lowerNext = false;
  let i = 0;
  let spelled = 0;
  let plainWords = 0;
  while (i < words.length) {
    const w = words[i];
    // Modifiers for the next letter.
    if (w === "mayuscula" || w === "capital") { upperNext = true; i++; continue; }
    if (w === "minuscula" || w === "small") { lowerNext = true; i++; continue; }
    if (w === "doble" && i + 1 < words.length && letters[words[i + 1]]?.length === 1) {
      const c = letters[words[i + 1]];
      out += c + c; spelled += 2; i += 2; continue;
    }
    // Modifiers for the previous letter.
    if (out && (w === "con" || w === "with") && ["tilde", "acento", "accent"].includes(words[i + 1] ?? "")) {
      const last = out.slice(-1);
      if (ACCENTED[last]) out = out.slice(0, -1) + ACCENTED[last];
      i += 2; continue;
    }
    if (out && (w === "acentuada" || w === "acentuado")) {
      const last = out.slice(-1);
      if (ACCENTED[last]) out = out.slice(0, -1) + ACCENTED[last];
      i++; continue;
    }

    let piece: string | null = null;
    let used = 0;
    for (const s of symbolNames) {
      const n = startsWith(s, i);
      if (n) { piece = symbols[s]; used = n; break; }
    }
    if (piece === null) {
      for (const name of names) {
        const n = startsWith(name, i);
        if (n) { piece = letters[name]; used = n; break; }
      }
    }
    if (piece === null && digits[w]) { piece = digits[w]; used = 1; }
    if (piece === null && /^[a-zñ]$/.test(w)) { piece = w; used = 1; }
    if (piece === null && /^\d+$/.test(w)) { piece = w; used = 1; }
    if (piece === null) {
      // An ordinary word: allowed only next to symbols ("nil arroba gmail punto com").
      piece = w;
      used = 1;
      plainWords++;
    }

    // "N de Navarra" / "be de Barcelona": the example word confirms the letter and is skipped.
    // "de" alone stays the letter D.
    for (const ex of examples) {
      const n = startsWith(ex, i + used);
      const word = words[i + used + n];
      if (n && word && word.length > 1 && piece.length === 1 && /[a-zñ]/.test(piece) && word[0] === piece) {
        used += n + 1;
        break;
      }
    }

    if (/^[a-zñ]+$/.test(piece)) {
      if (upperNext) piece = piece.toUpperCase();
      spelled += piece.length;
    }
    if (lowerNext) piece = piece.toLowerCase();
    upperNext = lowerNext = false;
    out += piece;
    i += used;
  }
  const hasSymbols = /[@._\-/+]/.test(out);
  if (plainWords > 0 && !hasSymbols) return null;
  // One stray word like "a" or "o" counts too: in this mode short answers are usually letters.
  return spelled > 0 || hasSymbols || /\d/.test(out) ? out : null;
}

/** Turns one utterance into an edit of the field. */
export function interpretDictation(text: string, lang: string): DictationEdit | null {
  const l = langOf(lang);
  const t = stripPolite(normalizeForSpelling(text));
  if (!t) return null;
  for (const table of [COMMANDS[l], ...(l === "en" ? [] : [COMMANDS.en])]) {
    for (const [edit, phrases] of table) if (phrases.includes(t)) return edit;
  }

  const appendPrefix = (APPEND_PREFIXES[l] ?? []).find((p) => t === p || t.startsWith(p + " "));
  const raw = cleanValue(text);
  const body = appendPrefix ? dropWords(raw, appendPrefix.split(" ").length) : raw;

  const spelled = parseSpelling(body, lang);
  if (spelled !== null) return { kind: "append", value: spelled, spelled: true };
  if (appendPrefix) return { kind: "append", value: body, spelled: false };

  const prefixes = [...(VALUE_PREFIXES[l] ?? [])].sort((a, b) => b.length - a.length);
  const valuePrefix = prefixes.find((p) => t.startsWith(p + " "));
  const value = valuePrefix ? dropWords(raw, valuePrefix.split(" ").length) : raw;
  // The prefix may hide spelling: "se escribe ene i ele".
  const spelledValue = parseSpelling(value, lang);
  if (spelledValue !== null) return { kind: "set", value: capitalizeWords(spelledValue) };
  return { kind: "set", value };
}

/** What the recognizer wrote, without the trailing full stop and surrounding quotes. */
function cleanValue(text: string): string {
  return text.trim().replace(/^[«"“]+|[»"”]+$/g, "").replace(/[.。]+$/, "").replace(/\s+/g, " ").trim();
}

function dropWords(text: string, n: number): string {
  return text.split(" ").slice(n).join(" ").replace(/^[,:]\s*/, "").trim();
}

function capitalizeWords(s: string): string {
  if (/[@0-9_/]/.test(s)) return s;
  return s.replace(/(^|\s)([a-zñáéíóú])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** Applies an edit. Spelled letters at the start of a word are capitalized (names, places). */
export function applyEdit(value: string, edit: DictationEdit): string {
  switch (edit.kind) {
    case "set":
      return edit.value;
    case "append": {
      if (!edit.spelled) return value && !value.endsWith(" ") ? `${value} ${edit.value}` : value + edit.value;
      // Spelled letters continue the current word. Emails, codes and numbers keep their case.
      const capitalize = !/[@0-9_/.]/.test(value + edit.value);
      let out = value;
      for (const ch of edit.value) {
        const wordStart = out === "" || out.endsWith(" ");
        out += capitalize && wordStart ? ch.toUpperCase() : ch;
      }
      return out;
    }
    case "backspace":
      return value.slice(0, Math.max(0, value.length - edit.count));
    case "delete_word":
      return value.trimEnd().replace(/\S+$/, "").trimEnd();
    case "clear":
      return "";
    case "accent": {
      for (let k = value.length - 1; k >= 0; k--) {
        if (ACCENTED[value[k]]) return value.slice(0, k) + ACCENTED[value[k]] + value.slice(k + 1);
      }
      return value;
    }
    case "uppercase":
      return value.toUpperCase();
    case "lowercase":
      return value.toLowerCase();
    case "space":
      return value.endsWith(" ") ? value : `${value} `;
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the value back, letter by letter

const SPOKEN: Record<string, Record<string, string>> = {
  es: {
    a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "hache", i: "i", j: "jota", k: "ka",
    l: "ele", m: "eme", n: "ene", ñ: "eñe", o: "o", p: "pe", q: "cu", r: "erre", s: "ese", t: "te", u: "u",
    v: "uve", w: "uve doble", x: "equis", y: "i griega", z: "zeta",
    " ": "espacio", "@": "arroba", ".": "punto", "-": "guion", _: "guion bajo", "/": "barra", ",": "coma", "+": "más",
  },
  en: { " ": "space", "@": "at", ".": "dot", "-": "dash", _: "underscore", "/": "slash", ",": "comma", "+": "plus" },
};
const ACCENT_WORD: Record<string, string> = { es: "con tilde", en: "with an accent" };
const CAPITAL_WORD: Record<string, string> = { es: "mayúscula", en: "capital" };

/** "Nil Pérez" → "ene, i, ele; espacio; pe, e con tilde, erre, e, zeta". */
export function spellOut(value: string, lang: string): string {
  const l = SPOKEN[lang.split("-")[0].toLowerCase()] ? lang.split("-")[0].toLowerCase() : "en";
  const names = SPOKEN[l];
  const parts: string[] = [];
  for (const [k, ch] of [...value].entries()) {
    const lower = ch.toLowerCase();
    const base = lower.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const accented = lower !== base && lower !== "ñ";
    let name = names[lower === "ñ" ? "ñ" : base] ?? base.toUpperCase();
    if (accented) name += ` ${ACCENT_WORD[l]}`;
    // Capitals are only mentioned in the middle of a word (the start of a word is assumed).
    const wordStart = k === 0 || value[k - 1] === " ";
    if (ch !== lower && !wordStart) name += ` ${CAPITAL_WORD[l]}`;
    parts.push(name);
  }
  return parts.join(", ");
}
