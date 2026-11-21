// Punto de entrada del módulo de manos (rol C). Uso típico:
//
//   const interaccion = new InteraccionManos();
//   interaccion.on((e) => { const a = accionDe(e, "documento"); if (a) enviar(a, e); });
//   await crearRastreador(video, (f) => interaccion.procesar(f));
//   interaccion.fijarDocumento(esquinasDeB1);

export * from "./tipos.ts";
export {
  InteraccionManos,
  OPCIONES_POR_DEFECTO,
  PERFIL_MOVILIDAD_REDUCIDA,
  direccionIndice,
  sectorEnPantalla,
  type Diagnostico,
  type OpcionesInteraccion,
} from "./interaccion.ts";
export { accionDe, MAPAS, MENU_RADIAL, menuPara, type Accion, type Contexto } from "./acciones.ts";
export { clasificarPose, estadoDedos } from "./poses.ts";
export { DetectorCabeza } from "./cabeza.ts";
export { crearRastreador, type Rastreador, type OpcionesRastreador } from "./rastreador.ts";
