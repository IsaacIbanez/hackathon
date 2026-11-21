import { test } from "node:test";
import assert from "node:assert/strict";
import { InteraccionManos } from "../interaccion.ts";
import { accionDe } from "../acciones.ts";
import { DetectorCabeza } from "../cabeza.ts";
import type { Cara, EventoManos, FrameManos, Mano } from "../tipos.ts";
import { FORMAS, mano } from "./mano.ts";

const PASO = 33;
const repetir = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

function simular(ctl: InteraccionManos, frames: (Mano | null)[], t0 = 0): EventoManos[] {
  const eventos: EventoManos[] = [];
  const quitar = ctl.on((e) => eventos.push(e));
  frames.forEach((m, i) => ctl.procesar({ t: t0 + i * PASO, manos: m ? [m] : [] }));
  quitar();
  return eventos;
}

test("modo despertar: los gestos se ignoran hasta mantener la palma ~1 s", () => {
  const ctl = new InteraccionManos({ requiereDespertar: true });
  const ev = simular(ctl, [
    ...repetir(mano(FORMAS.pulgar_arriba), 20), // dormido: se ignora
    ...repetir(mano(FORMAS.palma), 40), // despierta (sin disparar "pausar")
    ...repetir(mano(FORMAS.pulgar_arriba), 20), // ahora sí
  ]);
  const acciones = ev.map((e) => accionDe(e)).filter(Boolean);
  assert.deepEqual(acciones, ["despertar", "leer"]);
});

test("modo despertar: se vuelve a dormir tras un rato sin actividad", () => {
  const ctl = new InteraccionManos({ requiereDespertar: true, dormirMs: 500 });
  const ev = simular(ctl, [...repetir(mano(FORMAS.palma), 40), ...repetir(null, 30)]);
  assert.deepEqual(
    ev.filter((e) => e.tipo === "modo").map((e) => e.tipo === "modo" && e.despierto),
    [true, false],
  );
});

test("pulgar abajo es 'deshacer' en documento y 'borrar_campo' en formulario", () => {
  const ev = simular(new InteraccionManos(), repetir(mano(FORMAS.pulgar_abajo), 20));
  const g = ev.find((e) => e.tipo === "gesto")!;
  assert.equal(accionDe(g, "documento"), "deshacer");
  assert.equal(accionDe(g, "formulario"), "borrar_campo");
});

test("pinza y arrastrar emite inicio, movimiento y fin con el desplazamiento", () => {
  const ctl = new InteraccionManos();
  const frames = [
    ...Array.from({ length: 15 }, (_, i) => mano({ ...FORMAS.pinza, dy: -0.01 * i })), // sube
    ...repetir(mano(FORMAS.palma), 10),
  ];
  const ev = simular(ctl, frames).filter((e) => e.tipo === "arrastre");
  assert.equal(ev[0].tipo === "arrastre" && ev[0].fase, "inicio");
  const fin = ev[ev.length - 1];
  assert.ok(fin.tipo === "arrastre" && fin.fase === "fin" && fin.dy < -0.1, JSON.stringify(fin));
  const mover = ev.find((e) => e.tipo === "arrastre" && e.fase === "mover")!;
  assert.equal(accionDe(mover, "documento"), "velocidad_voz");
  assert.equal(accionDe(mover, "pc"), "desplazar");
});

test("menú radial: ✌️ lo abre y mover la mano hacia arriba elige 'repetir'", () => {
  const ctl = new InteraccionManos();
  const frames = [
    ...repetir(mano(FORMAS.victoria), 15), // abre el menú
    ...repetir(mano({ ...FORMAS.victoria, dy: -0.12 }), 30), // arriba y espera
  ];
  const ev = simular(ctl, frames).filter((e) => e.tipo === "menu");
  const fases = ev.map((e) => e.tipo === "menu" && `${e.fase}:${e.sector}`);
  assert.deepEqual(fases, ["abrir:null", "resaltar:arriba", "elegir:arriba"]);
  assert.equal(accionDe(ev[2]), "repetir");
});

test("menú radial: la derecha del usuario es la izquierda de la imagen", () => {
  const ctl = new InteraccionManos();
  const frames = [...repetir(mano(FORMAS.victoria), 15), ...repetir(mano({ ...FORMAS.victoria, dx: -0.12 }), 30)];
  const elegir = simular(ctl, frames).find((e) => e.tipo === "menu" && e.fase === "elegir");
  assert.ok(elegir && elegir.tipo === "menu" && elegir.sector === "derecha");
});

test("menú radial: se cierra solo si no se elige nada", () => {
  const ctl = new InteraccionManos({ caducidadMenuMs: 500 });
  const ev = simular(ctl, repetir(mano(FORMAS.victoria), 40)).filter((e) => e.tipo === "menu");
  assert.deepEqual(
    ev.map((e) => e.tipo === "menu" && e.fase),
    ["abrir", "cerrar"],
  );
});

// ---- Cabeza ----

/** Cara sintética: solo rellenamos los puntos que usa el detector. */
function cara(narizX: number, narizY: number, ojosCerrados = false): Cara {
  const puntos = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  puntos[10] = { x: 0.5, y: 0.3, z: 0 }; // frente
  puntos[152] = { x: 0.5, y: 0.7, z: 0 }; // barbilla
  puntos[234] = { x: 0.35, y: 0.5, z: 0 }; // mejilla
  puntos[454] = { x: 0.65, y: 0.5, z: 0 };
  puntos[1] = { x: narizX, y: narizY, z: 0 };
  const v = ojosCerrados ? 0.9 : 0.05;
  return { puntos, expresiones: { eyeBlinkLeft: v, eyeBlinkRight: v } };
}

function oscilar(det: DetectorCabeza, eje: "x" | "y") {
  const r: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = 0.04 * Math.sin((i / 30) * 2 * Math.PI * 1.0);
    const g = det.procesar(i * PASO, eje === "y" ? cara(0.5, 0.5 + d) : cara(0.5 + d, 0.5));
    if (g) r.push(g);
  }
  return r;
}

test("cabeza: asentir (arriba-abajo) y negar (lado a lado)", () => {
  assert.deepEqual(oscilar(new DetectorCabeza(), "y"), ["asentir"]);
  assert.deepEqual(oscilar(new DetectorCabeza(), "x"), ["negar"]);
});

test("cabeza: un parpadeo normal no cuenta, uno largo sí", () => {
  const det = new DetectorCabeza();
  const r: (string | null)[] = [];
  for (let i = 0; i < 5; i++) r.push(det.procesar(i * PASO, cara(0.5, 0.5, true))); // ~150 ms
  for (let i = 5; i < 10; i++) r.push(det.procesar(i * PASO, cara(0.5, 0.5)));
  for (let i = 10; i < 40; i++) r.push(det.procesar(i * PASO, cara(0.5, 0.5, true))); // ~1 s
  assert.deepEqual(r.filter(Boolean), ["parpadeo_largo"]);
});

test("cabeza: el evento pasa por el controlador y se traduce según el contexto", () => {
  const ctl = new InteraccionManos();
  const ev: EventoManos[] = [];
  ctl.on((e) => ev.push(e));
  for (let i = 0; i < 30; i++) {
    const d = 0.04 * Math.sin((i / 30) * 2 * Math.PI);
    const f: FrameManos = { t: i * PASO, manos: [], cara: cara(0.5, 0.5 + d) };
    ctl.procesar(f);
  }
  const c = ev.find((e) => e.tipo === "cabeza")!;
  assert.equal(accionDe(c, "pc"), "intro");
});
