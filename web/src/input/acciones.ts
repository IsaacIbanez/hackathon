// Traducción de eventos de mano y cabeza a acciones de la app. Es la parte que verá el resto
// del equipo: "qué quiere hacer el usuario", sin detalles de landmarks.
//
// Pocos gestos, muchas acciones: el mismo gesto significa cosas distintas según el contexto
// (leyendo un documento, rellenando un formulario o usando el PC).

import type { EventoManos, GestoCabeza, SectorMenu } from "./tipos.ts";

export type Contexto = "documento" | "formulario" | "pc";

export type Accion =
  // Documento
  | "leer"
  | "pausar"
  | "siguiente"
  | "anterior"
  | "explicar_aqui"
  | "velocidad_voz"
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
  | "desplazar"
  // Comunes
  | "deshacer"
  | "despertar"
  | "dormir"
  // Menú radial
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
  arrastre: Accion | null;
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
    arrastre: "velocidad_voz",
    cabeza: { asentir: "leer", negar: "pausar", parpadeo_largo: "explicar_aqui" },
  },
  formulario: {
    pulgar_arriba: "confirmar_campo",
    pulgar_abajo: "borrar_campo",
    palma: "pausar",
    deslizar_derecha: "campo_siguiente",
    deslizar_izquierda: "campo_anterior",
    seleccion: "dictar_campo",
    arrastre: null,
    cabeza: { asentir: "confirmar_campo", negar: "borrar_campo", parpadeo_largo: "dictar_campo" },
  },
  pc: {
    pulgar_arriba: "intro",
    pulgar_abajo: "deshacer",
    palma: "escape",
    deslizar_derecha: "pestana_siguiente",
    deslizar_izquierda: "pestana_anterior",
    seleccion: "clic",
    arrastre: "desplazar",
    cabeza: { asentir: "intro", negar: "escape", parpadeo_largo: "clic" },
  },
};

/** Opciones del menú radial (✌️), iguales en todos los contextos. */
export const MENU_RADIAL: Record<SectorMenu, Accion> = {
  arriba: "repetir",
  derecha: "copiar_texto",
  abajo: "dictar",
  izquierda: "pedir_ayuda",
};

/**
 * Acción que corresponde a un evento en un contexto, o null si el evento no es una acción
 * (puntero, presencia de la mano, apertura del menú...). Para "arrastre" solo devuelve la acción
 * en la fase "mover": el valor está en evento.dx / evento.dy.
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
    case "arrastre":
      return evento.fase === "mover" ? m.arrastre : null;
    case "menu":
      return evento.fase === "elegir" && evento.sector ? MENU_RADIAL[evento.sector] : null;
    case "cabeza":
      return m.cabeza[evento.gesto];
    case "modo":
      return evento.despierto ? "despertar" : "dormir";
    default:
      return null;
  }
}
