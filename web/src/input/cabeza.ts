// Gestos de cabeza (experimental): asentir y negar, a partir de los puntos
// de MediaPipe FaceLandmarker. Pensado para quien no puede usar las manos.

import type { Cara, GestoCabeza } from "./tipos.ts";

// Índices de la malla de 478 puntos de MediaPipe.
const NARIZ = 1;
const FRENTE = 10;
const BARBILLA = 152;
const MEJILLA_IZQ = 234;
const MEJILLA_DER = 454;

export interface OpcionesCabeza {
  /** Ventana en la que buscar el movimiento de ida y vuelta. */
  ventanaMs: number;
  /** Amplitud mínima del movimiento, relativa al tamaño de la cara. */
  amplitud: number;
  /** Cuánto debe dominar el eje del gesto sobre el otro. */
  dominancia: number;
  /** Pausa tras un gesto de cabeza. */
  esperaMs: number;
}

export const OPCIONES_CABEZA: OpcionesCabeza = {
  ventanaMs: 1200,
  amplitud: 0.12,
  dominancia: 1.8,
  esperaMs: 1200,
};

export class DetectorCabeza {
  private op: OpcionesCabeza;
  private historial: { t: number; x: number; y: number }[] = [];
  private tUltimo = -Infinity;

  constructor(op: Partial<OpcionesCabeza> = {}) {
    this.op = { ...OPCIONES_CABEZA, ...op };
  }

  /** Devuelve un gesto de cabeza si se acaba de completar en este frame. */
  procesar(t: number, cara: Cara | null | undefined): GestoCabeza | null {
    if (!cara || cara.puntos.length < 455) {
      this.historial = [];
      return null;
    }
    const pts = cara.puntos;
    const alto = Math.hypot(pts[FRENTE].x - pts[BARBILLA].x, pts[FRENTE].y - pts[BARBILLA].y) || 1;
    const ancho = Math.hypot(pts[MEJILLA_IZQ].x - pts[MEJILLA_DER].x, pts[MEJILLA_IZQ].y - pts[MEJILLA_DER].y) || 1;
    // Posición de la nariz relativa al centro de la cara: así no cuenta mover todo el cuerpo.
    const cx = (pts[MEJILLA_IZQ].x + pts[MEJILLA_DER].x) / 2;
    const cy = (pts[FRENTE].y + pts[BARBILLA].y) / 2;
    const x = (pts[NARIZ].x - cx) / ancho;
    const y = (pts[NARIZ].y - cy) / alto;

    const enEspera = t - this.tUltimo < this.op.esperaMs;

    this.historial.push({ t, x, y });
    while (this.historial.length && t - this.historial[0].t > this.op.ventanaMs) this.historial.shift();
    if (enEspera || this.historial.length < 6) return null;

    const xs = this.historial.map((h) => h.x);
    const ys = this.historial.map((h) => h.y);
    const rx = Math.max(...xs) - Math.min(...xs);
    const ry = Math.max(...ys) - Math.min(...ys);
    // Ida y vuelta: el valor actual ha regresado cerca del inicio tras alejarse.
    const vuelta = (vals: number[], rango: number) => Math.abs(vals[vals.length - 1] - vals[0]) < 0.4 * rango;
    if (ry > this.op.amplitud && ry > this.op.dominancia * rx && vuelta(ys, ry)) return this.emitir(t, "asentir");
    if (rx > this.op.amplitud && rx > this.op.dominancia * ry && vuelta(xs, rx)) return this.emitir(t, "negar");
    return null;
  }

  private emitir(t: number, g: GestoCabeza): GestoCabeza {
    this.tUltimo = t;
    this.historial = [];
    return g;
  }
}
