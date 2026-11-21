import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldAt, findFields, nextEmptyField, writeValue } from "../voice/formFields.ts";

const blocks = [
  { id: "b1", text: "AXA Seguros — Declaración de siniestro", box: { x: 0.08, y: 0.05, w: 0.84, h: 0.06 } },
  { id: "b2", text: "Nombre y apellidos: ____________", box: { x: 0.08, y: 0.18, w: 0.6, h: 0.04 } },
  { id: "b3", text: "Fecha del siniestro: __/__/____", box: { x: 0.08, y: 0.25, w: 0.5, h: 0.04 } },
  { id: "b4", text: "Firma del asegurado", box: { x: 0.55, y: 0.85, w: 0.35, h: 0.04 } },
];

test("fields are the blocks with a blank, labelled by their text", () => {
  assert.deepEqual(
    findFields(blocks).map((f) => [f.id, f.label]),
    [["b2", "Nombre y apellidos"], ["b3", "Fecha del siniestro"]],
  );
});

test("the value is written in the blank", () => {
  assert.equal(writeValue("Nombre y apellidos: ____________", "Nil March"), "Nombre y apellidos: Nil March");
  assert.equal(writeValue("Fecha del siniestro: __/__/____", "21/11/2026"), "Fecha del siniestro: 21/11/2026");
  assert.equal(writeValue("Teléfono:", "600123123"), "Teléfono: 600123123");
});

test("pointing picks the field under the finger; otherwise the next empty one", () => {
  const fields = findFields(blocks);
  assert.equal(fieldAt(fields, { x: 0.3, y: 0.2 })?.id, "b2");
  assert.equal(fieldAt(fields, { x: 0.9, y: 0.6 }), null);
  assert.equal(nextEmptyField(fields, {})?.id, "b2");
  assert.equal(nextEmptyField(fields, { b2: "Nil" }, "b2")?.id, "b3");
  assert.equal(nextEmptyField(fields, { b2: "Nil", b3: "hoy" }), null);
});
