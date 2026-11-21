// Controlador de interacción con las manos: recibe frames con landmarks y emite
// eventos de alto nivel (gesto estable, deslizar, puntero, selección por permanencia y,
// como experimentales, modo dormido/despierto, nivel con la pinza, menú radial y cabeza).
// No depende de MediaPipe ni del DOM: se puede probar con datos sintéticos.

import { DetectorCabeza, type OpcionesCabeza } from "./cabeza.ts";
import { FiltroOneEuro } from "./filtro.ts";
import { aplicarHomografia, distancia, distancia2D, homografiaDocumento, media } from "./geometria.ts";
import { clasificarPose, estadoDedos, puntosParaForma, tamanoMano, UMBRALES_POR_DEFECTO, type Umbrales } from "./poses.ts";
import {
  P,
  type Esquinas,
  type EventoManos,
  type FrameManos,
  type Gesto,
  type Mano,
  type Punto,
  type SectorMenu,
} from "./tipos.ts";

export interface OpcionesInteraccion {
  /** Tiempo que una pose debe mantenerse (y la mano quieta) para emitirse. */
  duracionGestoMs: number;
  /** Movimiento máximo del centro de la palma durante ese tiempo (unidades de alto de imagen). */
  quietudGesto: number;
  /** Tiempo sin mano antes de darla por perdida. */
  perdidaManoMs: number;
  /** Ventana de tiempo para detectar un deslizamiento. */
  ventanaDeslizarMs: number;
  /** Desplazamiento horizontal mínimo (fracción del ancho) para un deslizamiento. */
  distanciaDeslizar: number;
  /** Pausa tras un deslizamiento en la que no se detectan otros gestos. */
  esperaDeslizarMs: number;
  /** Tiempo señalando quieto para que cuente como selección ("clic por permanencia"). */
  permanenciaMs: number;
  /** Radio de quietud del puntero para la permanencia (unidades de alto de imagen). */
  radioPermanencia: number;
  /** Intervalo mínimo entre eventos de puntero y de nivel (limita el tráfico). */
  intervaloPunteroMs: number;
  /** Adelanto del puntero más allá de la punta del índice, en longitudes de la última falange. */
  adelantoPuntero: number;
  /** true si la cámara mira al usuario (las direcciones se dan desde su punto de vista). */
  espejo: boolean;
  umbrales: Umbrales;

  // ---- Experimentales ----
  /** Si es true, se ignoran los gestos hasta "despertar" con la palma abierta mantenida. */
  requiereDespertar: boolean;
  /** Tiempo con la palma abierta y quieta para despertar. */
  despertarMs: number;
  /** Tiempo sin actividad para volver a dormir. */
  dormirMs: number;
  /** Separación pulgar–índice (relativa al tamaño de la mano) que corresponde al nivel 0. */
  nivelMin: number;
  /** Separación pulgar–índice que corresponde al nivel 1. */
  nivelMax: number;
  /** Recorrido mínimo de la punta del índice para elegir en el menú (alto de imagen). */
  gestoMenu: number;
  /** Tiempo máximo de ese recorrido: tiene que ser un gesto rápido. */
  ventanaMenuMs: number;
  /** Tras abrir el menú, se ignoran movimientos durante este tiempo (la mano aún se coloca). */
  esperaMenuMs: number;
  /** El menú se cierra solo tras este tiempo. */
  caducidadMenuMs: number;
  /** Opciones del detector de gestos de cabeza. */
  cabeza: Partial<OpcionesCabeza>;
}

export const OPCIONES_POR_DEFECTO: OpcionesInteraccion = {
  duracionGestoMs: 300,
  quietudGesto: 0.06,
  perdidaManoMs: 300,
  ventanaDeslizarMs: 400,
  distanciaDeslizar: 0.2,
  esperaDeslizarMs: 700,
  permanenciaMs: 900,
  radioPermanencia: 0.025,
  intervaloPunteroMs: 66,
  adelantoPuntero: 0.5,
  espejo: true,
  umbrales: UMBRALES_POR_DEFECTO,
  requiereDespertar: false,
  despertarMs: 1000,
  dormirMs: 10000,
  nivelMin: 0.25,
  nivelMax: 1.1,
  gestoMenu: 0.07,
  ventanaMenuMs: 300,
  esperaMenuMs: 300,
  caducidadMenuMs: 5000,
  cabeza: {},
};

/** Perfil para movilidad reducida o temblor: gestos más lentos y tolerantes. */
export const PERFIL_MOVILIDAD_REDUCIDA: Partial<OpcionesInteraccion> = {
  duracionGestoMs: 600,
  quietudGesto: 0.1,
  permanenciaMs: 1500,
  radioPermanencia: 0.045,
  distanciaDeslizar: 0.15,
  ventanaDeslizarMs: 700,
  despertarMs: 1500,
  ventanaMenuMs: 500,
  gestoMenu: 0.06,
  caducidadMenuMs: 8000,
};

type Oyente = (e: EventoManos) => void;

interface EstadoMenu {
  centro: Punto; // imagen, sin aspecto (para dibujar)
  tApertura: number;
  /** Posiciones recientes de la punta del índice (x corregida por aspecto). */
  historial: { t: number; x: number; y: number }[];
}

interface EstadoNivel {
  valor: number;
  /** Valores recientes: al terminar se usa uno de antes de cerrar la mano. */
  historial: { t: number; valor: number }[];
  tUltimoValido: number;
  tUltimoEvento: number;
  pulgar: Punto;
  indice: Punto;
}

/** Eventos que cuentan como actividad (mantienen despierto el sistema). */
const ACTIVIDAD = new Set<EventoManos["tipo"]>(["gesto", "deslizar", "seleccion", "nivel", "menu", "cabeza"]);

export class InteraccionManos {
  private op: OpcionesInteraccion;
  private oyentes = new Set<Oyente>();
  private homografia: number[] | null = null;

  // Presencia
  private presente = false;
  private tUltimaMano = -Infinity;

  // Gesto estable
  private gestoEstable: Gesto = "ninguno";
  private candidato: Gesto = "ninguno";
  private tCandidato = 0;
  private posCandidato: Punto = { x: 0, y: 0 };
  private poseActual: Gesto = "ninguno";

  // Deslizar
  private historial: { t: number; x: number; y: number }[] = [];
  private tUltimoDeslizar = -Infinity;

  // Puntero
  private fx = new FiltroOneEuro();
  private fy = new FiltroOneEuro();
  private tUltimoPuntero = -Infinity;
  private tUltimoSenalar = -Infinity;
  private ancla: Punto | null = null;
  private tAncla = 0;
  private seleccionHecha = false;
  private ultimoPuntero: Punto | null = null;

  // Experimentales
  private despierto = true;
  private tActividad = 0;
  private tInicioDespertar: number | null = null;
  private posDespertar: Punto = { x: 0, y: 0 };
  private menu: EstadoMenu | null = null;
  private nivel: EstadoNivel | null = null;
  private fNivel = new FiltroOneEuro({ minCorte: 1.5, beta: 0.5, corteDerivada: 1.0 });
  private cabeza: DetectorCabeza;

  constructor(op: Partial<OpcionesInteraccion> = {}) {
    this.op = { ...OPCIONES_POR_DEFECTO, ...op };
    this.despierto = !this.op.requiereDespertar;
    this.cabeza = new DetectorCabeza(this.op.cabeza);
  }

  on(oyente: Oyente): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  /** Cambia opciones en caliente (p. ej. activar el perfil de movilidad reducida). */
  configurar(op: Partial<OpcionesInteraccion>): void {
    const antes = this.op.requiereDespertar;
    this.op = { ...this.op, ...op };
    if (op.cabeza) this.cabeza = new DetectorCabeza(this.op.cabeza);
    if (antes !== this.op.requiereDespertar) this.despierto = !this.op.requiereDespertar;
  }

  get opciones(): Readonly<OpcionesInteraccion> {
    return this.op;
  }

  /** Esquinas del documento en la imagen (las da B1), o null si no hay documento. */
  fijarDocumento(esquinas: Esquinas | null): void {
    this.homografia = esquinas ? homografiaDocumento(esquinas) : null;
  }

  /** Pose detectada en el último frame (sin estabilizar), útil para depurar. */
  get pose(): Gesto {
    return this.poseActual;
  }

  get gesto(): Gesto {
    return this.gestoEstable;
  }

  get puntero(): Punto | null {
    return this.ultimoPuntero;
  }

  get estaDespierto(): boolean {
    return this.despierto;
  }

  /** Progreso [0,1] de la palma mantenida para despertar (para mostrar una barra). */
  progresoDespertar(t: number): number {
    if (this.despierto || this.tInicioDespertar === null) return 0;
    return Math.min(1, (t - this.tInicioDespertar) / this.op.despertarMs);
  }

  get menuAbierto(): { centro: Punto } | null {
    return this.menu ? { centro: this.menu.centro } : null;
  }

  /** Control de nivel activo: valor y puntas de pulgar e índice (imagen) para dibujar la línea. */
  get nivelActivo(): { valor: number; pulgar: Punto; indice: Punto } | null {
    const n = this.nivel;
    return n ? { valor: n.valor, pulgar: n.pulgar, indice: n.indice } : null;
  }

  procesar(frame: FrameManos): void {
    const { t } = frame;
    const aspecto = frame.aspecto ?? 1;

    this.procesarCabeza(t, frame);

    if (this.despierto && this.op.requiereDespertar && t - this.tActividad > this.op.dormirMs) {
      this.dormir(t);
    }

    const mano = elegirMano(frame.manos);
    if (!mano) {
      this.poseActual = "ninguno";
      if (this.presente && t - this.tUltimaMano > this.op.perdidaManoMs) {
        this.presente = false;
        this.terminarNivel(t);
        this.cerrarMenu(t);
        this.reiniciarSeguimiento();
        if (this.gestoEstable !== "ninguno") {
          this.gestoEstable = "ninguno";
          this.emitir({ tipo: "gesto", gesto: "ninguno", t });
        }
        this.emitir({ tipo: "mano", presente: false, t });
      }
      return;
    }

    this.tUltimaMano = t;
    if (!this.presente) {
      this.presente = true;
      this.emitir({ tipo: "mano", presente: true, t });
    }

    const pose = clasificarPose(mano, aspecto, this.op.umbrales);
    this.poseActual = pose;
    const centro = centroPalma(mano, aspecto);

    if (!this.despierto) {
      this.intentarDespertar(t, pose, centro);
      return;
    }
    if (this.menu) {
      this.actualizarMenu(t, pose, centro, mano, aspecto);
      return;
    }
    if (this.actualizarNivel(t, pose, centro, mano, aspecto)) return;

    const deslizo = this.detectarDeslizar(t, centro, pose, aspecto);
    if (!deslizo) this.estabilizarGesto(t, pose, centro, mano, aspecto);
    this.actualizarPuntero(t, mano, pose, aspecto);
  }

  // ---------- Gestos estables ----------

  private estabilizarGesto(t: number, pose: Gesto, centro: Punto, mano: Mano, aspecto: number): void {
    if (t - this.tUltimoDeslizar < this.op.esperaDeslizarMs) {
      // Tras deslizar, la mano sigue abierta: no lo confundimos con "palma".
      this.reiniciarCandidato(t, pose, centro);
      return;
    }
    // Se exige la mano quieta para que un movimiento (p. ej. deslizar) no dispare gestos.
    // "senalar" es la excepción: al señalar, la mano se mueve a propósito.
    const movido = pose !== "senalar" && distancia2D(centro, this.posCandidato) > this.op.quietudGesto;
    if (pose !== this.candidato || movido) {
      this.reiniciarCandidato(t, pose, centro);
      return;
    }
    if (t - this.tCandidato >= this.op.duracionGestoMs && this.candidato !== this.gestoEstable) {
      this.gestoEstable = this.candidato;
      this.emitir({ tipo: "gesto", gesto: this.gestoEstable, t });
      if (this.gestoEstable === "victoria") this.abrirMenu(t, mano, aspecto);
    }
  }

  private reiniciarCandidato(t: number, pose: Gesto, centro: Punto): void {
    this.candidato = pose;
    this.tCandidato = t;
    this.posCandidato = centro;
  }

  // ---------- Deslizar ----------

  private detectarDeslizar(t: number, centro: Punto, pose: Gesto, aspecto: number): boolean {
    if (pose === "senalar" || pose === "pinza") {
      this.historial = [];
      return false;
    }
    // Guardamos x en unidades de ancho (sin aspecto) para comparar con distanciaDeslizar.
    this.historial.push({ t, x: centro.x / aspecto, y: centro.y });
    while (this.historial.length && t - this.historial[0].t > this.op.ventanaDeslizarMs) {
      this.historial.shift();
    }
    if (t - this.tUltimoDeslizar < this.op.esperaDeslizarMs || this.historial.length < 3) return false;

    const primero = this.historial[0];
    const dx = centro.x / aspecto - primero.x;
    const dy = centro.y - primero.y;
    if (Math.abs(dx) < this.op.distanciaDeslizar || Math.abs(dy) > 0.6 * Math.abs(dx * aspecto)) {
      return false;
    }
    // En la imagen sin espejo, si el usuario mueve la mano hacia SU derecha, x disminuye.
    const haciaDerechaImagen = dx > 0;
    const direccion = haciaDerechaImagen !== this.op.espejo ? "derecha" : "izquierda";
    this.tUltimoDeslizar = t;
    this.historial = [];
    this.emitir({ tipo: "deslizar", direccion, t });
    return true;
  }

  // ---------- Puntero ----------

  private actualizarPuntero(t: number, mano: Mano, pose: Gesto, aspecto: number): void {
    if (pose === "senalar") this.tUltimoSenalar = t;
    // Toleramos fallos breves de la clasificación mientras se señala.
    const senalando = t - this.tUltimoSenalar <= 150;
    if (!senalando) {
      this.ultimoPuntero = null;
      this.ancla = null;
      this.seleccionHecha = false;
      this.fx.reiniciar();
      this.fy.reiniciar();
      return;
    }

    const punta = mano.puntos[P.INDICE_PUNTA];
    const dip = mano.puntos[P.INDICE_DIP];
    const crudo: Punto = {
      x: punta.x + (punta.x - dip.x) * this.op.adelantoPuntero,
      y: punta.y + (punta.y - dip.y) * this.op.adelantoPuntero,
    };
    const p: Punto = { x: this.fx.filtrar(crudo.x, t), y: this.fy.filtrar(crudo.y, t) };
    this.ultimoPuntero = p;
    const enDocumento = this.aDocumento(p);

    // Selección por permanencia: el puntero quieto un rato dentro de un radio.
    if (!this.ancla || distancia2D(p, this.ancla, aspecto) > this.op.radioPermanencia) {
      // Para volver a seleccionar hay que salir claramente del radio.
      if (!this.ancla || distancia2D(p, this.ancla, aspecto) > 2 * this.op.radioPermanencia) {
        this.seleccionHecha = false;
      }
      if (!this.seleccionHecha) {
        this.ancla = p;
        this.tAncla = t;
      }
    } else if (!this.seleccionHecha && t - this.tAncla >= this.op.permanenciaMs) {
      this.seleccionHecha = true;
      this.emitir({ tipo: "seleccion", imagen: p, documento: enDocumento, t });
    }

    if (t - this.tUltimoPuntero >= this.op.intervaloPunteroMs) {
      this.tUltimoPuntero = t;
      this.emitir({ tipo: "puntero", imagen: p, documento: enDocumento, t });
    }
  }

  private aDocumento(p: Punto): Punto | null {
    if (!this.homografia) return null;
    const d = aplicarHomografia(this.homografia, p);
    if (!d || d.x < 0 || d.x > 1 || d.y < 0 || d.y > 1) return null;
    return d;
  }

  // ---------- Experimental: dormido / despierto ----------

  private intentarDespertar(t: number, pose: Gesto, centro: Punto): void {
    const quieta = distancia2D(centro, this.posDespertar) <= this.op.quietudGesto;
    if (pose !== "palma") {
      this.tInicioDespertar = null;
      return;
    }
    if (this.tInicioDespertar === null || !quieta) {
      this.tInicioDespertar = t;
      this.posDespertar = centro;
      return;
    }
    if (t - this.tInicioDespertar >= this.op.despertarMs) this.despertar(t, "palma");
  }

  private despertar(t: number, poseActual: Gesto): void {
    this.despierto = true;
    this.tInicioDespertar = null;
    this.tActividad = t;
    // La palma con la que se despierta no debe disparar además "pausar".
    this.gestoEstable = poseActual;
    this.candidato = poseActual;
    this.tCandidato = t;
    this.emitir({ tipo: "modo", despierto: true, t });
  }

  private dormir(t: number): void {
    this.despierto = false;
    this.terminarNivel(t);
    this.cerrarMenu(t);
    this.reiniciarSeguimiento();
    this.gestoEstable = "ninguno";
    this.emitir({ tipo: "modo", despierto: false, t });
  }

  // ---------- Experimental: nivel con la pinza ----------

  /**
   * Se empieza con la pinza ("OK": pulgar e índice juntos y los otros dedos estirados). Mientras
   * los otros dedos sigan estirados, el nivel es la separación pulgar–índice. Cerrar la mano o
   * bajarla lo termina. Devuelve true si el frame lo ha consumido el control de nivel.
   */
  private actualizarNivel(t: number, pose: Gesto, centro: Punto, mano: Mano, aspecto: number): boolean {
    const pts = puntosParaForma(mano, aspecto);
    const d = estadoDedos(pts, this.op.umbrales);
    const otrosEstirados = [d.corazon, d.anular, d.menique].filter(Boolean).length >= 2;

    if (!this.nivel) {
      if (pose !== "pinza") return false;
      this.fNivel.reiniciar();
    } else if (!otrosEstirados) {
      // Toleramos fallos breves de la clasificación.
      if (t - this.nivel.tUltimoValido <= 200) return true;
      this.terminarNivel(t);
      this.reiniciarCandidato(t, pose, centro);
      return false;
    }

    const separacion = distancia(pts[P.PULGAR_PUNTA], pts[P.INDICE_PUNTA]) / tamanoMano(pts);
    const crudo = (separacion - this.op.nivelMin) / (this.op.nivelMax - this.op.nivelMin);
    const valor = Math.min(1, Math.max(0, this.fNivel.filtrar(Math.min(1, Math.max(0, crudo)), t)));
    const pulgar = { x: mano.puntos[P.PULGAR_PUNTA].x, y: mano.puntos[P.PULGAR_PUNTA].y };
    const indice = { x: mano.puntos[P.INDICE_PUNTA].x, y: mano.puntos[P.INDICE_PUNTA].y };
    this.ultimoPuntero = null;

    if (!this.nivel) {
      this.nivel = { valor, historial: [{ t, valor }], tUltimoValido: t, tUltimoEvento: t, pulgar, indice };
      this.emitir({ tipo: "nivel", fase: "inicio", valor, t });
      return true;
    }
    const n = this.nivel;
    n.valor = valor;
    n.pulgar = pulgar;
    n.indice = indice;
    n.tUltimoValido = t;
    n.historial.push({ t, valor });
    while (n.historial.length && t - n.historial[0].t > 400) n.historial.shift();
    if (t - n.tUltimoEvento >= this.op.intervaloPunteroMs) {
      n.tUltimoEvento = t;
      this.emitir({ tipo: "nivel", fase: "mover", valor, t });
    }
    return true;
  }

  private terminarNivel(t: number): void {
    const n = this.nivel;
    if (!n) return;
    this.nivel = null;
    // Al cerrar la mano, pulgar e índice se mueven: nos quedamos con el valor de ~0,3 s antes.
    const previo = n.historial.find((h) => h.t >= n.tUltimoValido - 300) ?? n.historial[0];
    this.emitir({ tipo: "nivel", fase: "fin", valor: previo?.valor ?? n.valor, t });
  }

  // ---------- Experimental: menú radial ----------

  private abrirMenu(t: number, mano: Mano, aspecto: number): void {
    const c = centroPalma(mano, aspecto);
    const centro = { x: c.x / aspecto, y: c.y };
    this.menu = { centro, tApertura: t, historial: [] };
    this.ultimoPuntero = null;
    this.emitir({ tipo: "menu", fase: "abrir", sector: null, centro, t });
  }

  /** Con el menú abierto, un movimiento rápido de la punta del índice elige la dirección. */
  private actualizarMenu(t: number, pose: Gesto, centro: Punto, mano: Mano, aspecto: number): void {
    const m = this.menu!;
    if (t - m.tApertura > this.op.caducidadMenuMs) {
      this.cerrarMenu(t);
      return;
    }
    if (t - m.tApertura < this.op.esperaMenuMs) return;

    const punta = mano.puntos[P.INDICE_PUNTA];
    m.historial.push({ t, x: punta.x * aspecto, y: punta.y });
    while (m.historial.length && t - m.historial[0].t > this.op.ventanaMenuMs) m.historial.shift();
    if (m.historial.length < 2) return;

    const primero = m.historial[0];
    const dxImagen = punta.x * aspecto - primero.x;
    const dx = this.op.espejo ? -dxImagen : dxImagen;
    const dy = punta.y - primero.y;
    // Rápido (dentro de la ventana), largo y claramente en un eje.
    const largo = Math.hypot(dx, dy) >= this.op.gestoMenu;
    const claro = Math.max(Math.abs(dx), Math.abs(dy)) > 1.5 * Math.min(Math.abs(dx), Math.abs(dy));
    if (!largo || !claro) return;

    const sector: SectorMenu =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "derecha" : "izquierda") : dy > 0 ? "abajo" : "arriba";
    this.menu = null;
    this.emitir({ tipo: "menu", fase: "elegir", sector, centro: m.centro, t });
    // Hay que cambiar de pose antes de volver a abrir el menú.
    this.gestoEstable = pose;
    this.reiniciarCandidato(t, pose, centro);
  }

  private cerrarMenu(t: number): void {
    if (!this.menu) return;
    const { centro } = this.menu;
    this.menu = null;
    this.emitir({ tipo: "menu", fase: "cerrar", sector: null, centro, t });
  }

  // ---------- Experimental: cabeza ----------

  private procesarCabeza(t: number, frame: FrameManos): void {
    if (frame.cara === undefined) return; // detección de cara desactivada
    const g = this.cabeza.procesar(t, frame.cara);
    if (!g) return;
    if (!this.despierto) {
      // Para quien no puede usar las manos: asentir también despierta.
      if (g === "asentir") this.despertar(t, this.poseActual);
      return;
    }
    this.emitir({ tipo: "cabeza", gesto: g, t });
  }

  // ---------- Utilidades ----------

  private reiniciarSeguimiento(): void {
    this.candidato = "ninguno";
    this.historial = [];
    this.tUltimoSenalar = -Infinity;
    this.ultimoPuntero = null;
    this.ancla = null;
    this.seleccionHecha = false;
    this.tInicioDespertar = null;
    this.fx.reiniciar();
    this.fy.reiniciar();
  }

  private emitir(e: EventoManos): void {
    if (ACTIVIDAD.has(e.tipo)) this.tActividad = e.t;
    for (const o of this.oyentes) o(e);
  }
}

function elegirMano(manos: Mano[]): Mano | null {
  let mejor: Mano | null = null;
  for (const m of manos) {
    if (m.puntos.length !== 21) continue;
    if (!mejor || (m.confianza ?? 0) > (mejor.confianza ?? 0)) mejor = m;
  }
  return mejor;
}

/** Centro de la palma en la imagen, con x corregida por aspecto (unidades de alto). */
function centroPalma(mano: Mano, aspecto: number): Punto {
  const c = media(
    [P.MUNECA, P.INDICE_MCP, P.CORAZON_MCP, P.ANULAR_MCP, P.MENIQUE_MCP].map((i) => mano.puntos[i]),
  );
  return { x: c.x * aspecto, y: c.y };
}
