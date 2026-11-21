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

/** Controlador con el volumen ya armado (como tras elegir "ajustar volumen" en el menú). */
function armado(op: ConstructorParameters<typeof InteraccionManos>[0] = {}): InteraccionManos {
  const ctl = new InteraccionManos(op);
  ctl.iniciarNivel(0);
  return ctl;
}

/** Pinza con el pulgar separado `sep` del índice (hacia abajo), los otros tres dedos estirados. */
function pinzaAbierta(sep: number): Mano {
  const m = mano(FORMAS.pinza);
  const i = m.puntos[8];
  m.puntos[4] = { x: i.x, y: i.y + sep, z: 0 };
  return m;
}

test("pinza: sin elegir 'ajustar volumen' en el menú, la pinza no hace nada", () => {
  const ev = simular(new InteraccionManos(), [...repetir(mano(FORMAS.pinza), 10), ...repetir(pinzaAbierta(0.2), 20)]);
  assert.ok(!ev.some((e) => e.tipo === "nivel"));
});

test("pinza: armado y sin juntar los dedos, se cancela solo", () => {
  const ctl = armado({ esperaNivelMs: 500 });
  const fases = simular(ctl, repetir(mano(FORMAS.senalar), 30))
    .filter((e) => e.tipo === "nivel")
    .map((e) => e.tipo === "nivel" && e.fase);
  assert.deepEqual(fases, ["cancelar"]);
  assert.equal(ctl.nivelEsperando, false);
});

test("pinza: la separación pulgar–índice controla un nivel de 0 a 1 (volumen)", () => {
  const ctl = armado();
  const frames = [
    ...repetir(mano(FORMAS.pinza), 5), // empieza juntando los dedos
    ...Array.from({ length: 20 }, (_, i) => pinzaAbierta(0.01 * (i + 1))), // abre poco a poco
    ...repetir(pinzaAbierta(0.2), 45), // se queda muy abierta y quieta: se confirma
  ];
  const ev = simular(ctl, frames).filter((e) => e.tipo === "nivel");
  assert.equal(ev[0].tipo === "nivel" && ev[0].fase, "inicio");
  assert.ok(ev[0].tipo === "nivel" && ev[0].valor < 0.1, "empieza cerca de 0");
  const movs = ev.filter((e) => e.tipo === "nivel" && e.fase === "mover").map((e) => (e.tipo === "nivel" ? e.valor : 0));
  assert.ok(movs[movs.length - 1] > 0.7, `sube al abrir: ${movs[movs.length - 1]}`);
  const fin = ev[ev.length - 1];
  assert.ok(fin.tipo === "nivel" && fin.fase === "fin" && fin.valor > 0.7, `al quedarse quieto se confirma: ${JSON.stringify(fin)}`);
  assert.equal(accionDe(fin, "documento"), "volumen");
});

test("pinza: con el control activo no se disparan otros gestos", () => {
  const ctl = armado({ confirmarNivelMs: 5000 });
  const ev = simular(ctl, [...repetir(mano(FORMAS.pinza), 8), ...repetir(pinzaAbierta(0.2), 30)]);
  assert.ok(ev.some((e) => e.tipo === "nivel"));
  assert.ok(!ev.some((e) => e.tipo === "gesto" || e.tipo === "deslizar"));
});

test("pinza: el nivel va en escalones de 10 % y la escala llega de 0 % a 100 %", () => {
  const ctl = armado();
  const frames = [
    ...repetir(mano(FORMAS.pinza), 8),
    ...Array.from({ length: 30 }, (_, i) => pinzaAbierta(0.25 * ((i + 1) / 30))),
    ...repetir(pinzaAbierta(0.25), 5),
  ];
  const valores = simular(ctl, frames)
    .filter((e) => e.tipo === "nivel")
    .map((e) => (e.tipo === "nivel" ? e.valor : -1));
  assert.equal(valores[0], 0, "dedos juntos = 0 %");
  assert.equal(valores[valores.length - 1], 1, "abiertos del todo = 100 %");
  for (const v of valores) assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, `escalón: ${v}`);
});

test("pinza: quedarse quieto ~1 s en el mismo valor lo confirma", () => {
  const ctl = armado();
  const frames = [
    ...repetir(mano(FORMAS.pinza), 8),
    ...Array.from({ length: 10 }, (_, i) => pinzaAbierta(0.01 * (i + 1))), // abre un poco
    ...repetir(pinzaAbierta(0.1), 40), // y se queda quieto
  ];
  const ev = simular(ctl, frames).filter((e) => e.tipo === "nivel");
  const fin = ev.filter((e) => e.tipo === "nivel" && e.fase === "fin");
  assert.equal(fin.length, 1, "se confirma una vez y no vuelve a empezar");
  const ultimoMover = ev.filter((e) => e.tipo === "nivel" && e.fase === "mover").pop()!;
  assert.ok(fin[0].tipo === "nivel" && ultimoMover.tipo === "nivel" && fin[0].valor === ultimoMover.valor);
  assert.ok(fin[0].t - ultimoMover.t >= 1000);
});

test("pinza: volver a juntar los dedos siempre da 0 % y la escala no se desfasa", () => {
  const ctl = armado({ confirmarNivelMs: 10000 });
  const ida = Array.from({ length: 15 }, (_, i) => pinzaAbierta(0.25 * ((i + 1) / 15)));
  const vuelta = Array.from({ length: 15 }, (_, i) => pinzaAbierta(0.25 * (1 - (i + 1) / 15)));
  const frames = [...repetir(mano(FORMAS.pinza), 8), ...ida, ...vuelta, ...ida, ...vuelta, ...repetir(pinzaAbierta(0), 10)];
  const movs = simular(ctl, frames)
    .filter((e) => e.tipo === "nivel" && e.fase === "mover")
    .map((e) => (e.tipo === "nivel" ? e.valor : -1));
  assert.equal(movs.filter((v) => v === 1).length, 2, `llega a 100 % las dos veces: ${movs}`);
  assert.equal(movs[movs.length - 1], 0, `vuelve a 0 %: ${movs}`);
});

test("pinza: la calibración guiada fija el 0 % y el 100 % con un pequeño margen", () => {
  const ctl = armado();
  ctl.fijarEscalaNivel(0.1, 1.1);
  assert.deepEqual(ctl.escalaNivel, { cero: 0.2, lleno: 1.0 });
});

test("pinza: el valor es lineal con la medida de la línea pulgar–índice", () => {
  const ctl = armado({ confirmarNivelMs: 10000, histeresisNivel: 0 });
  // Tamaño de la mano sintética en pantalla ≈ 0,2: separar 0,125 da una medida ≈ 0,62 → 50 %.
  const ev = simular(ctl, [...repetir(mano(FORMAS.pinza), 8), ...repetir(pinzaAbierta(0.125), 15)]);
  const ultimo = ev.filter((e) => e.tipo === "nivel").pop()!;
  assert.ok(ultimo.tipo === "nivel" && ultimo.valor === 0.5, JSON.stringify(ultimo));
});

test("pinza: temblar en el límite entre dos escalones no hace saltar el valor", () => {
  const ctl = armado({ confirmarNivelMs: 10000 });
  // Fijamos la escala abriendo del todo y volviendo a la mitad.
  const frames = [
    ...repetir(mano(FORMAS.pinza), 8),
    ...repetir(pinzaAbierta(0.2), 10),
    ...repetir(pinzaAbierta(0.1), 15),
  ];
  const ev1 = simular(ctl, frames).filter((e) => e.tipo === "nivel" && e.fase === "mover").length;
  // Oscila un poco alrededor del mismo punto.
  const temblor = Array.from({ length: 30 }, (_, i) => pinzaAbierta(0.1 + (i % 2 ? 0.003 : -0.003)));
  const ev2 = simular(ctl, temblor, 25 * 33).filter((e) => e.tipo === "nivel" && e.fase === "mover");
  assert.ok(ev1 > 0);
  assert.equal(ev2.length, 0, `cambios por temblor: ${ev2.length}`);
});

test("pinza: también funciona con los otros tres dedos doblados", () => {
  const conOtrosDoblados = (sep: number) => {
    const m = mano({ pinza: true });
    m.puntos[4] = { x: m.puntos[8].x, y: m.puntos[8].y + sep, z: 0 };
    return m;
  };
  const ev = simular(armado(), [
    ...repetir(conOtrosDoblados(0.005), 8),
    ...repetir(conOtrosDoblados(0.2), 15),
  ]).filter((e) => e.tipo === "nivel");
  assert.ok(ev.length > 0 && ev[ev.length - 1].tipo === "nivel");
  const ultimo = ev[ev.length - 1];
  assert.ok(ultimo.tipo === "nivel" && ultimo.valor > 0.7, JSON.stringify(ultimo));
});

/** Abre el menú con ✌️ y luego señala con ☝️ con la mano desplazada (dx, dy) en la imagen. */
function punteroEnMenu(dx: number, dy: number): Mano[] {
  return [...repetir(mano(FORMAS.victoria), 15), ...repetir(mano({ ...FORMAS.senalar, dx, dy }), 30)];
}

test("menú: ✌️ lo abre y llevar el puntero a la opción de arriba ~0,5 s elige 'ajustar volumen'", () => {
  const ev = simular(new InteraccionManos(), punteroEnMenu(0, -0.3)).filter((e) => e.tipo === "menu");
  const fases = ev.map((e) => e.tipo === "menu" && `${e.fase}:${e.sector}`);
  assert.deepEqual(fases, ["abrir:null", "resaltar:arriba", "elegir:arriba"]);
  assert.equal(accionDe(ev[2]), "ajustar_volumen");
});

test("menú: las zonas de las opciones, vistas por el usuario", () => {
  // En la imagen sin espejo, la derecha del usuario es x decreciente.
  const casos: [number, number, string][] = [
    [0, 0.3, "abajo"],
    [-0.15, 0, "derecha"],
    [0.3, 0, "izquierda"],
  ];
  for (const [dx, dy, esperado] of casos) {
    const e = simular(new InteraccionManos(), punteroEnMenu(dx, dy)).find((e) => e.tipo === "menu" && e.fase === "elegir");
    assert.ok(e && e.tipo === "menu" && e.sector === esperado, `${dx},${dy} → ${e && e.tipo === "menu" && e.sector}`);
  }
});

test("menú: con el puntero en el centro no se elige nada", () => {
  const ev = simular(new InteraccionManos(), punteroEnMenu(0, 0));
  assert.ok(!ev.some((e) => e.tipo === "menu" && e.fase === "elegir"));
});

test("menú: mantener ✌️ no elige nada y se cierra solo", () => {
  const ctl = new InteraccionManos({ caducidadMenuMs: 800 });
  const ev = simular(ctl, repetir(mano(FORMAS.victoria), 50)).filter((e) => e.tipo === "menu");
  assert.deepEqual(
    ev.map((e) => e.tipo === "menu" && e.fase),
    ["abrir", "cerrar"],
  );
});

// ---- Mano usada ----

/** Le pone a la mano la etiqueta cruda de MediaPipe (por defecto coincide con la mano real). */
const conEtiqueta = (m: Mano, etiqueta: "Left" | "Right"): Mano => ({ ...m, lateralidad: etiqueta, confianza: 0.95 });

test("mano usada: se toma la etiqueta de MediaPipe y se estabiliza", () => {
  const ctl = new InteraccionManos();
  simular(ctl, repetir(conEtiqueta(mano(FORMAS.palma), "Right"), 20));
  assert.equal(ctl.manoUsada, "derecha");
  // Un par de frames mal etiquetados no la cambian.
  simular(ctl, repetir(conEtiqueta(mano(FORMAS.palma), "Left"), 2), 20 * 33);
  assert.equal(ctl.manoUsada, "derecha");
  ctl.configurar({ invertirLateralidad: true });
  assert.equal(ctl.manoUsada, "izquierda");
});

test("menú con la mano derecha: no hay opción a la derecha y 'pedir ayuda' queda a la izquierda", () => {
  const derecha = (m: Mano) => conEtiqueta(m, "Right");
  const ctl = new InteraccionManos();
  assert.deepEqual(ctl.sectoresMenu("derecha"), ["arriba", "abajo", "izquierda"]);

  const abrir = repetir(derecha(mano(FORMAS.victoria)), 20);
  const aLaDerecha = [...abrir, ...repetir(derecha(mano({ ...FORMAS.senalar, dx: -0.15 })), 30)];
  assert.ok(!simular(ctl, aLaDerecha).some((e) => e.tipo === "menu" && e.fase === "elegir"), "a la derecha no elige");

  const aLaIzquierda = [...abrir, ...repetir(derecha(mano({ ...FORMAS.senalar, dx: 0.3 })), 30)];
  const elegir = simular(new InteraccionManos(), aLaIzquierda).find((e) => e.tipo === "menu" && e.fase === "elegir")!;
  assert.ok(elegir.tipo === "menu" && elegir.sector === "izquierda" && elegir.mano === "derecha");
  assert.equal(accionDe(elegir), "pedir_ayuda");
});

test("menú con la mano izquierda: 'pedir ayuda' queda a la derecha", () => {
  const izquierda = (m: Mano) => conEtiqueta(m, "Left");
  const frames = [
    ...repetir(izquierda(mano(FORMAS.victoria)), 20),
    ...repetir(izquierda(mano({ ...FORMAS.senalar, dx: -0.15 })), 30),
  ];
  const elegir = simular(new InteraccionManos(), frames).find((e) => e.tipo === "menu" && e.fase === "elegir")!;
  assert.ok(elegir.tipo === "menu" && elegir.sector === "derecha");
  assert.equal(accionDe(elegir), "pedir_ayuda");
});

// ---- Palma hacia la cámara y puño ----

test("palma: con el dorso hacia la cámara no cuenta", () => {
  // La mano sintética tiene el índice a la izquierda de la imagen y el meñique a la derecha:
  // en una mano izquierda es la palma; en una derecha, el dorso.
  const palmaIzq = simular(new InteraccionManos(), repetir(conEtiqueta(mano(FORMAS.palma), "Left"), 20));
  assert.ok(palmaIzq.some((e) => e.tipo === "gesto" && e.gesto === "palma"), "izquierda: palma");
  const dorsoDer = simular(new InteraccionManos(), repetir(conEtiqueta(mano(FORMAS.palma), "Right"), 20));
  assert.ok(!dorsoDer.some((e) => e.tipo === "gesto" && e.gesto === "palma"), "derecha: dorso");
});

test("puño: desactivado por defecto, no se emite", () => {
  const ev = simular(new InteraccionManos(), repetir(mano(FORMAS.puno), 20));
  assert.ok(!ev.some((e) => e.tipo === "gesto" && e.gesto === "puno"));
  const conPuno = simular(new InteraccionManos({ usarPuno: true }), repetir(mano(FORMAS.puno), 20));
  assert.ok(conPuno.some((e) => e.tipo === "gesto" && e.gesto === "puno"));
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
