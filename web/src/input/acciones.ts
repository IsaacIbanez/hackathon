// Traducción de eventos de mano a acciones de la app. Es la parte que verá el resto
// del equipo: "qué quiere hacer el usuario", sin detalles de landmarks.

import type { EventoManos, Gesto } from "./tipos.ts";

export type Accion =
  | "leer" // empezar o reanudar la lectura
  | "pausar"
  | "siguiente"
  | "anterior"
  | "repetir"
  | "explicar_aqui"; // explicar la zona señalada del documento

export const MAPA_GESTOS: Partial<Record<Gesto, Accion>> = {
  pulgar_arriba: "leer",
  palma: "pausar",
  victoria: "repetir",
};

export function accionDe(evento: EventoManos, mapa = MAPA_GESTOS): Accion | null {
  switch (evento.tipo) {
    case "gesto":
      return mapa[evento.gesto] ?? null;
    case "deslizar":
      return evento.direccion === "derecha" ? "siguiente" : "anterior";
    case "seleccion":
      return "explicar_aqui";
    default:
      return null;
  }
}
