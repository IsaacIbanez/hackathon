import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, interpretDictation, parseSpelling, spellOut } from "../voice/spelling.ts";
import { FieldDictation } from "../voice/fieldDictation.ts";
import type { Listener } from "../voice/listener.ts";

/** Runs a sequence of utterances on an empty field, like a user would. */
function dictate(lang: string, ...utterances: string[]): string {
  let value = "";
  for (const u of utterances) {
    const edit = interpretDictation(u, lang);
    if (edit) value = applyEdit(value, edit);
  }
  return value;
}

test("a plain answer is written as said, without the full stop", () => {
  assert.equal(dictate("es-ES", "Nil March."), "Nil March");
  assert.equal(dictate("es-ES", "Me llamo Nil."), "Nil");
  assert.equal(dictate("es-ES", "Mi nombre es Pau Gómez"), "Pau Gómez");
});

test("spelling letter by letter builds the word and capitalizes its first letter", () => {
  assert.equal(dictate("es-ES", "ene, i, ele"), "Nil");
  assert.equal(dictate("es-ES", "N de Navarra, i, ele"), "Nil");
  assert.equal(dictate("es-ES", "eme a", "erre ce hache"), "March");
  assert.equal(dictate("es-ES", "se escribe ene i ele"), "Nil");
});

test("spelling continues the word; a space starts a new one", () => {
  assert.equal(dictate("es-ES", "Nil", "espacio", "eme a erre ce hache"), "Nil March");
  assert.equal(dictate("es-ES", "ene i ele espacio eme a erre ce hache"), "Nil March");
});

test("special letters: be alta, uve, doble ele, i griega, eñe, con tilde", () => {
  assert.equal(parseSpelling("be alta, uve baja", "es-ES"), "bv");
  assert.equal(parseSpelling("doble ele", "es-ES"), "ll");
  assert.equal(parseSpelling("i griega", "es-ES"), "y");
  assert.equal(parseSpelling("eñe", "es-ES"), "ñ");
  assert.equal(dictate("es-ES", "jota o ese e con tilde"), "José");
});

test("emails and numbers are spelled without capitals", () => {
  assert.equal(dictate("es-ES", "nil arroba gmail punto com"), "nil@gmail.com");
  assert.equal(dictate("es-ES", "seis cero cero uno dos tres"), "600123");
});

test("ordinary sentences are not mistaken for spelling", () => {
  assert.equal(parseSpelling("vivo en Lausana", "es-ES"), null);
  assert.equal(parseSpelling("Nil March", "es-ES"), null);
});

test("corrections: last letter, last word, accent, clear", () => {
  assert.equal(dictate("es-ES", "Nill", "borra la última letra"), "Nil");
  assert.equal(dictate("es-ES", "Nil March", "borra la última palabra"), "Nil");
  assert.equal(dictate("es-ES", "Jose", "con tilde"), "José");
  assert.equal(dictate("es-ES", "Nil", "borra todo, por favor"), "");
  assert.equal(dictate("es-ES", "Nil", "añade March"), "Nil March");
});

test("confirming, rejecting and reading back are commands, not values", () => {
  assert.deepEqual(interpretDictation("Sí, está bien.", "es-ES"), { kind: "confirm" });
  assert.deepEqual(interpretDictation("correcto", "es-ES"), { kind: "confirm" });
  assert.deepEqual(interpretDictation("No", "es-ES"), { kind: "reject" });
  assert.deepEqual(interpretDictation("¿Cómo está?", "es-ES"), { kind: "readback" });
  assert.deepEqual(interpretDictation("cancelar", "es-ES"), { kind: "cancel" });
  assert.deepEqual(interpretDictation("yes", "es-ES"), { kind: "confirm" });
});

test("the value is read back letter by letter", () => {
  assert.equal(spellOut("Nil", "es-ES"), "ene, i, ele");
  assert.equal(spellOut("José M", "es-ES"), "jota, o, ese, e con tilde, espacio, eme");
  assert.equal(spellOut("a@b.c", "es-ES"), "a, arroba, be, punto, ce");
});

test("English spelling works too", () => {
  assert.equal(dictate("en-GB", "n i l"), "Nil");
  assert.equal(dictate("en-GB", "my name is Nil", "delete last letter"), "Ni");
});

// ---- Field dictation (turns) ----


/** A listener that answers with a script, one reply per turn. */
function scripted(replies: string[]): Listener {
  return {
    name: "script",
    available: () => true,
    listen: async () => replies.shift() ?? "",
    finish() {},
    cancel() {},
  };
}

function run(replies: string[]) {
  const saved: string[] = [];
  const said: string[] = [];
  return new Promise<{ saved: string[]; said: string[]; d: FieldDictation }>((resolve) => {
    const d = new FieldDictation({
      lang: "es-ES",
      listener: scripted(replies),
      speaker: { isSpeaking: false, speak: (p) => said.push(p.text), stop() {}, onSpeakingChange: () => () => {} },
      onConfirm: (v) => saved.push(v),
      onState: (s) => {
        if (s.phase === "confirmed" || s.phase === "cancelled" || s.phase === "paused") setTimeout(() => resolve({ saved, said, d }), 0);
      },
    });
    d.start("Nombre");
  });
}

test("dictation only saves after the user confirms, and reads the value back letter by letter", async () => {
  const { saved, said, d } = await run(["ene i ele", "borra la última letra", "ele", "sí"]);
  assert.deepEqual(saved, ["Nil"]);
  assert.equal(d.state.phase, "confirmed");
  assert.ok(said.some((s) => s.includes("Llevo: Nil. Se escribe: ene, i, ele.")));
});

test("silence pauses the field without saving anything", async () => {
  const { saved, d } = await run(["Nil", "", ""]);
  assert.deepEqual(saved, []);
  assert.equal(d.state.phase, "paused");
  assert.equal(d.state.value, "Nil");
});

test("saying no keeps the draft and asks again; cancel saves nothing", async () => {
  const { saved, d } = await run(["Nil", "no", "cancelar"]);
  assert.deepEqual(saved, []);
  assert.equal(d.state.phase, "cancelled");
});
