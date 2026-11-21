import { test } from "node:test";
import assert from "node:assert/strict";
import { InteraccionManos } from "../interaccion.ts";
import { accionDe } from "../acciones.ts";
import type { EventoManos, Mano } from "../tipos.ts";
import { FORMAS, mano } from "./mano.ts";

const PASO = 33; // ~30 fps

function simular(ctl: InteraccionManos, frames: (Mano | null)[], t0 = 0): EventoManos[] {
  const eventos: EventoManos[] = [];
  const quitar = ctl.on((e) => eventos.push(e));
  frames.forEach((m, i) => ctl.procesar({ t: t0 + i * PASO, manos: m ? [m] : [] }));
  quitar();
  return eventos;
}

const repetir = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

test("un gesto mantenido se emite una sola vez", () => {
  const ctl = new InteraccionManos();
  const ev = simular(ctl, repetir(mano(FORMAS.pulgar_arriba), 30));
  const gestos = ev.filter((e) => e.tipo === "gesto");
  assert.deepEqual(
    gestos.map((e) => e.tipo === "gesto" && e.gesto),
    ["pulgar_arriba"],
  );
  assert.equal(accionDe(gestos[0]), "leer");
});

test("un gesto demasiado breve no se emite", () => {
  const ctl = new InteraccionManos();
  const frames = [...repetir(mano(FORMAS.puno), 15), ...repetir(mano(FORMAS.palma), 5), ...repetir(mano(FORMAS.puno), 5)];
  const ev = simular(ctl, frames);
  assert.ok(!ev.some((e) => e.tipo === "gesto" && e.gesto === "palma"));
});

test("deslizar la mano abierta hacia la derecha del usuario es 'siguiente' y no dispara 'pausar'", () => {
  const ctl = new InteraccionManos(); // espejo: true (cámara mirando al usuario)
  // En la imagen sin espejo, mover la mano a la derecha del usuario es x decreciente.
  const frames = Array.from({ length: 10 }, (_, i) => mano({ ...FORMAS.palma, dx: -0.04 * i }));
  const ev = simular(ctl, frames);
  const desl = ev.filter((e) => e.tipo === "deslizar");
  assert.equal(desl.length, 1);
  assert.equal(accionDe(desl[0]), "siguiente");
  assert.ok(!ev.some((e) => e.tipo === "gesto" && e.gesto === "palma"));
});

test("deslizar hacia la izquierda es 'anterior'", () => {
  const ctl = new InteraccionManos();
  const frames = Array.from({ length: 10 }, (_, i) => mano({ ...FORMAS.palma, dx: 0.04 * i }));
  const desl = simular(ctl, frames).filter((e) => e.tipo === "deslizar");
  assert.equal(desl.length, 1);
  assert.equal(accionDe(desl[0]), "anterior");
});

test("señalar emite puntero limitado en frecuencia y selección por permanencia", () => {
  const ctl = new InteraccionManos();
  const ev = simular(ctl, repetir(mano(FORMAS.senalar), 40)); // ~1,3 s
  const punteros = ev.filter((e) => e.tipo === "puntero");
  assert.ok(punteros.length >= 15 && punteros.length <= 22, `punteros: ${punteros.length}`);
  const sel = ev.filter((e) => e.tipo === "seleccion");
  assert.equal(sel.length, 1);
  assert.equal(accionDe(sel[0]), "explicar_aqui");
  // El puntero va un poco por delante de la punta del índice (y = 0,48).
  const p = punteros[punteros.length - 1];
  assert.ok(p.tipo === "puntero" && p.imagen.y < 0.48);
});

test("el puntero se traduce a coordenadas del documento", () => {
  const ctl = new InteraccionManos({ adelantoPuntero: 0 });
  // Documento que ocupa de x 0,34 a 0,54 y de y 0,38 a 0,58: la punta (0,44, 0,48) cae en el centro.
  ctl.fijarDocumento([
    { x: 0.34, y: 0.38 },
    { x: 0.54, y: 0.38 },
    { x: 0.54, y: 0.58 },
    { x: 0.34, y: 0.58 },
  ]);
  const ev = simular(ctl, repetir(mano(FORMAS.senalar), 10));
  const p = ev.filter((e) => e.tipo === "puntero").pop();
  assert.ok(p && p.tipo === "puntero" && p.documento);
  assert.ok(Math.abs(p.documento.x - 0.5) < 1e-6 && Math.abs(p.documento.y - 0.5) < 1e-6);
});

test("perder la mano emite mano ausente y resetea el gesto", () => {
  const ctl = new InteraccionManos({ usarPuno: true });
  const ev = simular(ctl, [...repetir(mano(FORMAS.puno), 15), ...repetir(null, 15)]);
  const tipos = ev.map((e) => (e.tipo === "gesto" ? `gesto:${e.gesto}` : e.tipo === "mano" ? `mano:${e.presente}` : e.tipo));
  assert.deepEqual(tipos, ["mano:true", "gesto:puno", "gesto:ninguno", "mano:false"]);
});
