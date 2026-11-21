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

/** Pinza con el pulgar separado `sep` del índice (hacia abajo), los otros tres dedos estirados. */
function pinzaAbierta(sep: number): Mano {
  const m = mano(FORMAS.pinza);
  const i = m.puntos[8];
  m.puntos[4] = { x: i.x, y: i.y + sep, z: 0 };
  return m;
}

test("pinza: la separación pulgar–índice controla un nivel de 0 a 1 (volumen)", () => {
  const ctl = new InteraccionManos();
  const frames = [
    ...repetir(mano(FORMAS.pinza), 5), // empieza juntando los dedos
    ...Array.from({ length: 20 }, (_, i) => pinzaAbierta(0.01 * (i + 1))), // abre poco a poco
    ...repetir(pinzaAbierta(0.2), 15), // se queda muy abierta
    ...repetir(mano(FORMAS.puno), 15), // cierra la mano: termina
  ];
  const ev = simular(ctl, frames).filter((e) => e.tipo === "nivel");
  assert.equal(ev[0].tipo === "nivel" && ev[0].fase, "inicio");
  assert.ok(ev[0].tipo === "nivel" && ev[0].valor < 0.1, "empieza cerca de 0");
  const movs = ev.filter((e) => e.tipo === "nivel" && e.fase === "mover").map((e) => (e.tipo === "nivel" ? e.valor : 0));
  assert.ok(movs[movs.length - 1] > 0.7, `sube al abrir: ${movs[movs.length - 1]}`);
  const fin = ev[ev.length - 1];
  assert.ok(fin.tipo === "nivel" && fin.fase === "fin" && fin.valor > 0.7, `al cerrar conserva el valor: ${JSON.stringify(fin)}`);
  assert.equal(accionDe(fin, "documento"), "volumen");
});

test("pinza: con el control activo no se disparan otros gestos", () => {
  const ctl = new InteraccionManos();
  const ev = simular(ctl, [...repetir(mano(FORMAS.pinza), 5), ...repetir(pinzaAbierta(0.2), 30)]);
  assert.ok(!ev.some((e) => e.tipo === "gesto" || e.tipo === "deslizar"));
});

/** Abre el menú con ✌️ y luego mueve rápido la mano (y el índice) dx, dy en 3 frames. */
function gestoMenu(dx: number, dy: number): Mano[] {
  return [
    ...repetir(mano(FORMAS.victoria), 25), // abre el menú (~0,3 s) y espera
    ...[1, 2, 3].map((k) => mano({ ...FORMAS.victoria, dx: (dx * k) / 3, dy: (dy * k) / 3 })),
    ...repetir(mano({ ...FORMAS.victoria, dx, dy }), 5),
  ];
}

test("menú radial: ✌️ lo abre y un gesto rápido hacia arriba elige 'repetir'", () => {
  const ev = simular(new InteraccionManos(), gestoMenu(0, -0.1)).filter((e) => e.tipo === "menu");
  assert.deepEqual(
    ev.map((e) => e.tipo === "menu" && `${e.fase}:${e.sector}`),
    ["abrir:null", "elegir:arriba"],
  );
  assert.equal(accionDe(ev[1]), "repetir");
});

test("menú radial: las 4 direcciones, desde el punto de vista del usuario", () => {
  const casos: [number, number, string][] = [
    [0, 0.1, "abajo"],
    [-0.1, 0, "derecha"], // en la imagen sin espejo, la derecha del usuario es x decreciente
    [0.1, 0, "izquierda"],
  ];
  for (const [dx, dy, esperado] of casos) {
    const e = simular(new InteraccionManos(), gestoMenu(dx, dy)).find((e) => e.tipo === "menu" && e.fase === "elegir");
    assert.ok(e && e.tipo === "menu" && e.sector === esperado, `${dx},${dy} → ${e && e.tipo === "menu" && e.sector}`);
  }
});

test("menú radial: un movimiento lento no elige nada", () => {
  const frames = [
    ...repetir(mano(FORMAS.victoria), 25),
    ...Array.from({ length: 40 }, (_, i) => mano({ ...FORMAS.victoria, dy: -0.004 * i })),
  ];
  const ev = simular(new InteraccionManos(), frames);
  assert.ok(!ev.some((e) => e.tipo === "menu" && e.fase === "elegir"));
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
function cara(narizX: number, narizY: number): Cara {
  const puntos = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  puntos[10] = { x: 0.5, y: 0.3, z: 0 }; // frente
  puntos[152] = { x: 0.5, y: 0.7, z: 0 }; // barbilla
  puntos[234] = { x: 0.35, y: 0.5, z: 0 }; // mejilla
  puntos[454] = { x: 0.65, y: 0.5, z: 0 };
  puntos[1] = { x: narizX, y: narizY, z: 0 };
  return { puntos };
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
