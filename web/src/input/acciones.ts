// Traducción de eventos de mano y cabeza a acciones de la app. Es la parte que verá el resto
// del equipo: "qué quiere hacer el usuario", sin detalles de landmarks.
//
// Pocos gestos, muchas acciones: el mismo gesto significa cosas distintas según el contexto
// (leyendo un documento, rellenando un formulario o usando el PC).

import type { EventoManos, GestoCabeza, LadoMano, SectorMenu } from "./tipos.ts";

export type Contexto = "documento" | "formulario" | "pc";

export type Accion =
  // Documento
  | "leer"
  | "pausar"
  | "siguiente"
  | "anterior"
  | "explicar_aqui"
  // Formulario
  | "confirmar_campo"
  | "campo_siguiente"
  | "campo_anterior"
  | "dictar_campo"
  | "borrar_campo"
  // PC
  | "intro"
  | "escape"
  | "pestana_siguiente"
  | "pestana_anterior"
  | "clic"
  // Comunes
  | "deshacer"
  | "volumen"
  | "despertar"
  | "dormir"
  // Menú radial
  | "ajustar_volumen"
  | "repetir"
  | "copiar_texto"
  | "dictar"
  | "pedir_ayuda";

interface MapaContexto {
  pulgar_arriba: Accion;
  pulgar_abajo: Accion;
  palma: Accion;
  deslizar_derecha: Accion;
  deslizar_izquierda: Accion;
  seleccion: Accion;
  /** Control continuo con la pinza; el valor está en evento.valor (0–1). */
  pinza: Accion | null;
  cabeza: Record<GestoCabeza, Accion>;
}

export const MAPAS: Record<Contexto, MapaContexto> = {
  documento: {
    pulgar_arriba: "leer",
    pulgar_abajo: "deshacer",
    palma: "pausar",
    deslizar_derecha: "siguiente",
    deslizar_izquierda: "anterior",
    seleccion: "explicar_aqui",
    pinza: "volumen",
    cabeza: { asentir: "leer", negar: "pausar" },
  },
  formulario: {
    pulgar_arriba: "confirmar_campo",
    pulgar_abajo: "borrar_campo",
    palma: "pausar",
    deslizar_derecha: "campo_siguiente",
    deslizar_izquierda: "campo_anterior",
    seleccion: "dictar_campo",
    pinza: "volumen",
    cabeza: { asentir: "confirmar_campo", negar: "borrar_campo" },
  },
  pc: {
    pulgar_arriba: "intro",
    pulgar_abajo: "deshacer",
    palma: "escape",
    deslizar_derecha: "pestana_siguiente",
    deslizar_izquierda: "pestana_anterior",
    seleccion: "clic",
    pinza: "volumen",
    cabeza: { asentir: "intro", negar: "escape" },
  },
};

/** Opciones del menú radial (✌️) cuando no se sabe qué mano se usa, iguales en todos los contextos. */
export const MENU_RADIAL: Record<SectorMenu, Accion> = {
  arriba: "ajustar_volumen",
  derecha: "dictar",
  abajo: "repetir",
  izquierda: "pedir_ayuda",
};

/**
 * Menú según la mano: se quita el lado de esa mano (llevar el puntero hacia fuera cuesta) y
 * "pedir ayuda" queda siempre en el lado cómodo, para que nunca se pierda. "Dictar" sale del menú.
 */
export function menuPara(mano: LadoMano | null): Partial<Record<SectorMenu, Accion>> {
  if (!mano) return MENU_RADIAL;
  const otroLado: SectorMenu = mano === "derecha" ? "izquierda" : "derecha";
  return { arriba: MENU_RADIAL.arriba, abajo: MENU_RADIAL.abajo, [otroLado]: "pedir_ayuda" };
}

/**
 * Acción que corresponde a un evento en un contexto, o null si el evento no es una acción
 * (puntero, presencia de la mano, apertura del menú...). Para "nivel" (pinza) devuelve la acción
 * en las fases "mover" y "fin": el valor (0–1) está en evento.valor.
 */
export function accionDe(evento: EventoManos, contexto: Contexto = "documento"): Accion | null {
  const m = MAPAS[contexto];
  switch (evento.tipo) {
    case "gesto":
      if (evento.gesto === "pulgar_arriba") return m.pulgar_arriba;
      if (evento.gesto === "pulgar_abajo") return m.pulgar_abajo;
      if (evento.gesto === "palma") return m.palma;
      return null; // victoria abre el menú; el resto no tiene acción propia
    case "deslizar":
      return evento.direccion === "derecha" ? m.deslizar_derecha : m.deslizar_izquierda;
    case "seleccion":
      return m.seleccion;
    case "nivel":
      return evento.fase === "mover" || evento.fase === "fin" ? m.pinza : null;
    case "menu":
      return evento.fase === "elegir" && evento.sector ? (menuPara(evento.mano)[evento.sector] ?? null) : null;
    case "cabeza":
      return m.cabeza[evento.gesto];
    case "modo":
      return evento.despierto ? "despertar" : "dormir";
    default:
      return null;
  }
}
