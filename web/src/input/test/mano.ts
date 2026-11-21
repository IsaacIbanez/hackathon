// Generador de manos sintéticas (coordenadas de imagen) para los tests.
import type { Mano, Punto3D } from "../tipos.ts";

export interface FormaMano {
  pulgar?: "fuera" | "arriba" | "abajo" | "doblado";
  indice?: boolean;
  corazon?: boolean;
  anular?: boolean;
  menique?: boolean;
  pinza?: boolean;
  /** Desplazamiento de toda la mano en la imagen. */
  dx?: number;
  dy?: number;
}

const p = (x: number, y: number, z = 0): Punto3D => ({ x, y, z });

/** Mano vertical (muñeca abajo) vista de frente. */
export function mano(f: FormaMano = {}): Mano {
  const pts: Punto3D[] = new Array(21);
  pts[0] = p(0.5, 0.8);
  // Pulgar
  pts[1] = p(0.42, 0.75);
  if (f.pulgar === "arriba") {
    pts[2] = p(0.4, 0.68);
    pts[3] = p(0.4, 0.57);
    pts[4] = p(0.4, 0.46);
  } else if (f.pulgar === "abajo") {
    pts[2] = p(0.4, 0.72);
    pts[3] = p(0.4, 0.83);
    pts[4] = p(0.4, 0.94);
  } else if (f.pulgar === "fuera") {
    pts[2] = p(0.38, 0.7);
    pts[3] = p(0.33, 0.65);
    pts[4] = p(0.28, 0.6);
  } else {
    pts[2] = p(0.4, 0.7);
    pts[3] = p(0.44, 0.66);
    pts[4] = p(0.47, 0.63);
  }
  const dedos: [number, boolean][] = [
    [0.44, !!f.indice],
    [0.48, !!f.corazon],
    [0.52, !!f.anular],
    [0.56, !!f.menique],
  ];
  dedos.forEach(([x, estirado], i) => {
    const b = 5 + i * 4;
    pts[b] = p(x, 0.6);
    if (estirado) {
      pts[b + 1] = p(x, 0.55);
      pts[b + 2] = p(x, 0.51);
      pts[b + 3] = p(x, 0.48);
    } else {
      pts[b + 1] = p(x, 0.55);
      pts[b + 2] = p(x, 0.58);
      pts[b + 3] = p(x, 0.63);
    }
  });
  if (f.pinza) {
    pts[6] = p(0.44, 0.55);
    pts[7] = p(0.42, 0.52);
    pts[8] = p(0.4, 0.54);
    pts[4] = p(0.4, 0.555);
  }
  const dx = f.dx ?? 0;
  const dy = f.dy ?? 0;
  return { puntos: pts.map((q) => p(q.x + dx, q.y + dy, q.z)), confianza: 0.9 };
}

export const FORMAS = {
  palma: { pulgar: "fuera", indice: true, corazon: true, anular: true, menique: true },
  senalar: { indice: true },
  victoria: { indice: true, corazon: true },
  puno: {},
  pulgar_arriba: { pulgar: "arriba" },
  pulgar_abajo: { pulgar: "abajo" },
  pinza: { pinza: true, corazon: true, anular: true, menique: true },
} satisfies Record<string, FormaMano>;

/** Gira toda la mano alrededor de la muñeca (grados; positivo = sentido horario en la imagen). */
export function rotar(m: Mano, grados: number): Mano {
  const a = (grados * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const o = m.puntos[0];
  return {
    ...m,
    puntos: m.puntos.map((q) => ({
      x: o.x + (q.x - o.x) * c - (q.y - o.y) * s,
      y: o.y + (q.x - o.x) * s + (q.y - o.y) * c,
      z: q.z,
    })),
  };
}
