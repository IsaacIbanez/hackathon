import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarPose } from "../poses.ts";
import { FORMAS, mano } from "./mano.ts";

for (const [nombre, forma] of Object.entries(FORMAS)) {
  test(`pose ${nombre}`, () => {
    assert.equal(clasificarPose(mano(forma)), nombre);
  });
}

test("la pose no cambia al mover la mano por la imagen", () => {
  assert.equal(clasificarPose(mano({ ...FORMAS.senalar, dx: -0.3, dy: 0.1 })), "senalar");
});

test("tres dedos estirados no es ningún gesto conocido", () => {
  assert.equal(clasificarPose(mano({ indice: true, corazon: true, anular: true })), "ninguno");
});
