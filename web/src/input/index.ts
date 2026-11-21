// Punto de entrada del módulo de manos (rol C). Uso típico:
//
//   const interaccion = new InteraccionManos();
//   interaccion.on((e) => { const a = accionDe(e); if (a) enviar(a, e); });
//   await crearRastreador(video, (f) => interaccion.procesar(f));
//   interaccion.fijarDocumento(esquinasDeB1);

export * from "./tipos.ts";
export { InteraccionManos, OPCIONES_POR_DEFECTO, type OpcionesInteraccion } from "./interaccion.ts";
export { accionDe, MAPA_GESTOS, type Accion } from "./acciones.ts";
export { clasificarPose, estadoDedos } from "./poses.ts";
export { crearRastreador, type Rastreador, type OpcionesRastreador } from "./rastreador.ts";
