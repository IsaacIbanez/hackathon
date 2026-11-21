// Tipos compartidos del módulo de manos (rol C).
// Coordenadas de imagen: normalizadas [0,1] sobre el frame de la cámara SIN espejo
// (las mismas que usa B1 para el documento). x hacia la derecha, y hacia abajo.

export interface Punto {
  x: number;
  y: number;
}

export interface Punto3D extends Punto {
  z: number;
}

/** Una mano detectada en un frame (21 puntos con el orden de MediaPipe). */
export interface Mano {
  /** 21 puntos en coordenadas de imagen normalizadas. */
  puntos: Punto3D[];
  /** 21 puntos en metros, centrados en la mano (más fiables para la pose). Opcional. */
  puntosMundo?: Punto3D[];
  /** "Left" o "Right" según MediaPipe. */
  lateralidad?: string;
  /** Confianza de la detección [0,1]. */
  confianza?: number;
}

export interface FrameManos {
  /** Marca de tiempo en milisegundos. */
  t: number;
  manos: Mano[];
  /** Ancho / alto del frame, para medir distancias en la imagen sin deformar. */
  aspecto?: number;
}

export type Gesto =
  | "ninguno"
  | "senalar"
  | "palma"
  | "puno"
  | "pulgar_arriba"
  | "victoria"
  | "pinza";

export type Direccion = "izquierda" | "derecha";

/** Esquinas del documento en coordenadas de imagen: sup-izq, sup-der, inf-der, inf-izq. */
export type Esquinas = [Punto, Punto, Punto, Punto];

export type EventoManos =
  | { tipo: "mano"; presente: boolean; t: number }
  | { tipo: "gesto"; gesto: Gesto; t: number }
  | { tipo: "deslizar"; direccion: Direccion; t: number }
  | {
      tipo: "puntero";
      imagen: Punto;
      /** Posición en el documento [0,1]x[0,1], o null si no hay documento o cae fuera. */
      documento: Punto | null;
      t: number;
    }
  | { tipo: "seleccion"; imagen: Punto; documento: Punto | null; t: number };

/** Índices de los 21 puntos de MediaPipe Hands. */
export const P = {
  MUNECA: 0,
  PULGAR_CMC: 1,
  PULGAR_MCP: 2,
  PULGAR_IP: 3,
  PULGAR_PUNTA: 4,
  INDICE_MCP: 5,
  INDICE_PIP: 6,
  INDICE_DIP: 7,
  INDICE_PUNTA: 8,
  CORAZON_MCP: 9,
  CORAZON_PIP: 10,
  CORAZON_DIP: 11,
  CORAZON_PUNTA: 12,
  ANULAR_MCP: 13,
  ANULAR_PIP: 14,
  ANULAR_DIP: 15,
  ANULAR_PUNTA: 16,
  MENIQUE_MCP: 17,
  MENIQUE_PIP: 18,
  MENIQUE_DIP: 19,
  MENIQUE_PUNTA: 20,
} as const;

/** Conexiones para dibujar el esqueleto de la mano. */
export const CONEXIONES: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
