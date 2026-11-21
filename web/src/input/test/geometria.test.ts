import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarHomografia, homografiaDocumento } from "../geometria.ts";
import type { Esquinas } from "../tipos.ts";

test("la homografía lleva las esquinas del documento al cuadrado unidad", () => {
  // Documento en perspectiva (trapecio).
  const esquinas: Esquinas = [
    { x: 0.3, y: 0.2 },
    { x: 0.7, y: 0.25 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.85 },
  ];
  const h = homografiaDocumento(esquinas);
  assert.ok(h);
  const esperado = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  esquinas.forEach((e, i) => {
    const r = aplicarHomografia(h, e)!;
    assert.ok(Math.abs(r.x - esperado[i][0]) < 1e-9 && Math.abs(r.y - esperado[i][1]) < 1e-9);
  });
});

test("esquinas degeneradas devuelven null", () => {
  const p = { x: 0.5, y: 0.5 };
  assert.equal(homografiaDocumento([p, p, p, p]), null);
});
