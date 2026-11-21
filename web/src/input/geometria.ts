import type { Esquinas, Punto, Punto3D } from "./tipos.ts";

export function distancia(a: Punto3D, b: Punto3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distancia2D(a: Punto, b: Punto, aspecto = 1): number {
  return Math.hypot((a.x - b.x) * aspecto, a.y - b.y);
}

export function media(puntos: Punto[]): Punto {
  let x = 0;
  let y = 0;
  for (const p of puntos) {
    x += p.x;
    y += p.y;
  }
  return { x: x / puntos.length, y: y / puntos.length };
}

/**
 * Homografía 3x3 (fila a fila, h[8] = 1) que lleva las 4 esquinas del documento
 * en la imagen a las esquinas del cuadrado unidad (0,0) (1,0) (1,1) (0,1).
 * Devuelve null si las esquinas están degeneradas.
 */
export function homografiaDocumento(esquinas: Esquinas): number[] | null {
  const destino: Punto[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  // Sistema A·h = b de 8 ecuaciones con 8 incógnitas.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = esquinas[i];
    const { x: u, y: v } = destino[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = resolver(A, b);
  return h ? [...h, 1] : null;
}

export function aplicarHomografia(h: number[], p: Punto): Punto | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Eliminación gaussiana con pivote parcial. */
function resolver(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let f = col + 1; f < n; f++) {
      if (Math.abs(M[f][col]) > Math.abs(M[piv][col])) piv = f;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const k = M[f][col] / M[col][col];
      for (let c = col; c <= n; c++) M[f][c] -= k * M[col][c];
    }
  }
  return M.map((fila, i) => fila[n] / M[i][i]);
}
