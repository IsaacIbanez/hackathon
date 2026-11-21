// Clasificación de la pose estática de una mano a partir de sus 21 puntos.
// Se usa la "rectitud" de cada dedo (longitud recta / longitud por las falanges),
// que no depende de la rotación ni de la distancia a la cámara.

import { distancia } from "./geometria.ts";
import { P, type Gesto, type Mano, type Punto3D } from "./tipos.ts";

export interface EstadoDedos {
  pulgar: boolean;
  indice: boolean;
  corazon: boolean;
  anular: boolean;
  menique: boolean;
}

export interface Umbrales {
  /** Rectitud a partir de la cual un dedo cuenta como estirado. */
  estirado: number;
  /** Rectitud del pulgar a partir de la cual cuenta como estirado. */
  pulgarEstirado: number;
  /** Distancia pulgar–índice (relativa al tamaño de la mano) para la pinza. */
  pinza: number;
}

export const UMBRALES_POR_DEFECTO: Umbrales = {
  estirado: 0.9,
  pulgarEstirado: 0.88,
  pinza: 0.35,
};

const CADENAS = {
  indice: [P.INDICE_MCP, P.INDICE_PIP, P.INDICE_DIP, P.INDICE_PUNTA],
  corazon: [P.CORAZON_MCP, P.CORAZON_PIP, P.CORAZON_DIP, P.CORAZON_PUNTA],
  anular: [P.ANULAR_MCP, P.ANULAR_PIP, P.ANULAR_DIP, P.ANULAR_PUNTA],
  menique: [P.MENIQUE_MCP, P.MENIQUE_PIP, P.MENIQUE_DIP, P.MENIQUE_PUNTA],
} as const;

const CADENA_PULGAR = [P.PULGAR_MCP, P.PULGAR_IP, P.PULGAR_PUNTA] as const;

/** 1 = dedo totalmente recto; valores bajos = dedo doblado. */
export function rectitud(pts: Punto3D[], cadena: readonly number[]): number {
  let porFalanges = 0;
  for (let i = 1; i < cadena.length; i++) {
    porFalanges += distancia(pts[cadena[i - 1]], pts[cadena[i]]);
  }
  if (porFalanges === 0) return 0;
  return distancia(pts[cadena[0]], pts[cadena[cadena.length - 1]]) / porFalanges;
}

/** Puntos donde medir la forma: los de mundo si existen; si no, los de imagen corregidos por aspecto. */
export function puntosParaForma(mano: Mano, aspecto = 1): Punto3D[] {
  if (mano.puntosMundo && mano.puntosMundo.length === 21) return mano.puntosMundo;
  return mano.puntos.map((p) => ({ x: p.x * aspecto, y: p.y, z: p.z * aspecto }));
}

export function estadoDedos(pts: Punto3D[], u: Umbrales = UMBRALES_POR_DEFECTO): EstadoDedos {
  const tam = tamanoMano(pts);
  const estirado = (cadena: readonly number[]) =>
    rectitud(pts, cadena) >= u.estirado &&
    // La punta debe quedar lejos de la muñeca: descarta dedos rectos pero plegados sobre la palma.
    distancia(pts[P.MUNECA], pts[cadena[cadena.length - 1]]) > 1.3 * distancia(pts[P.MUNECA], pts[cadena[0]]);
  // El pulgar se considera estirado si está recto y su punta se separa de la palma.
  const pulgar =
    rectitud(pts, CADENA_PULGAR) >= u.pulgarEstirado &&
    distancia(pts[P.PULGAR_PUNTA], pts[P.INDICE_MCP]) > 0.5 * tam;
  return {
    pulgar,
    indice: estirado(CADENAS.indice),
    corazon: estirado(CADENAS.corazon),
    anular: estirado(CADENAS.anular),
    menique: estirado(CADENAS.menique),
  };
}

/** Tamaño de referencia: muñeca → nudillo del corazón. */
export function tamanoMano(pts: Punto3D[]): number {
  return distancia(pts[P.MUNECA], pts[P.CORAZON_MCP]) || 1;
}

/**
 * Pose de la mano. `imagen` son los puntos de imagen (para saber qué es "arriba").
 */
export function clasificarPose(mano: Mano, aspecto = 1, u: Umbrales = UMBRALES_POR_DEFECTO): Gesto {
  const pts = puntosParaForma(mano, aspecto);
  if (pts.length !== 21) return "ninguno";
  const d = estadoDedos(pts, u);
  const otrosTres = [d.corazon, d.anular, d.menique];
  const nOtros = otrosTres.filter(Boolean).length;
  const tam = tamanoMano(pts);

  // Pinza ("OK"): puntas de pulgar e índice juntas y al menos dos de los otros dedos estirados.
  // Con los otros dedos doblados es un puño, donde el pulgar también queda cerca del índice.
  if (distancia(pts[P.PULGAR_PUNTA], pts[P.INDICE_PUNTA]) < u.pinza * tam && !d.indice && nOtros >= 2) {
    return "pinza";
  }
  if (d.indice && d.corazon && d.anular && d.menique) return "palma";
  if (d.indice && d.corazon && !d.anular && !d.menique) return "victoria";
  if (d.indice && nOtros === 0) return "senalar";
  if (!d.indice && nOtros === 0) {
    if (d.pulgar && pulgarHaciaArriba(mano, aspecto)) return "pulgar_arriba";
    return "puno";
  }
  return "ninguno";
}

/** El pulgar apunta hacia arriba en la imagen (y decrece) más que hacia los lados. */
export function pulgarHaciaArriba(mano: Mano, aspecto = 1): boolean {
  const base = mano.puntos[P.PULGAR_MCP];
  const punta = mano.puntos[P.PULGAR_PUNTA];
  const dx = (punta.x - base.x) * aspecto;
  const dy = punta.y - base.y;
  return dy < 0 && Math.abs(dy) > 1.2 * Math.abs(dx);
}
