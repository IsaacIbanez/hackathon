// Controlador de interacción con las manos: recibe frames con landmarks y emite
// eventos de alto nivel (gesto estable, deslizar, puntero y selección por permanencia).
// No depende de MediaPipe ni del DOM: se puede probar con datos sintéticos.

import { FiltroOneEuro } from "./filtro.ts";
import { aplicarHomografia, distancia2D, homografiaDocumento, media } from "./geometria.ts";
import { clasificarPose, UMBRALES_POR_DEFECTO, type Umbrales } from "./poses.ts";
import { P, type Esquinas, type EventoManos, type FrameManos, type Gesto, type Mano, type Punto } from "./tipos.ts";

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
  /** Intervalo mínimo entre eventos de puntero (limita el tráfico por WebSocket). */
  intervaloPunteroMs: number;
  /** Adelanto del puntero más allá de la punta del índice, en longitudes de la última falange. */
  adelantoPuntero: number;
  /** true si la cámara mira al usuario (las direcciones se dan desde su punto de vista). */
  espejo: boolean;
  umbrales: Umbrales;
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
};

type Oyente = (e: EventoManos) => void;

export class InteraccionManos {
  readonly op: OpcionesInteraccion;
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

  constructor(op: Partial<OpcionesInteraccion> = {}) {
    this.op = { ...OPCIONES_POR_DEFECTO, ...op };
  }

  on(oyente: Oyente): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
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

  procesar(frame: FrameManos): void {
    const { t } = frame;
    const aspecto = frame.aspecto ?? 1;
    const mano = elegirMano(frame.manos);

    if (!mano) {
      this.poseActual = "ninguno";
      if (this.presente && t - this.tUltimaMano > this.op.perdidaManoMs) {
        this.presente = false;
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

    const deslizo = this.detectarDeslizar(t, centro, pose, aspecto);
    if (!deslizo) this.estabilizarGesto(t, pose, centro);
    this.actualizarPuntero(t, mano, pose, aspecto);
  }

  private estabilizarGesto(t: number, pose: Gesto, centro: Punto): void {
    if (t - this.tUltimoDeslizar < this.op.esperaDeslizarMs) {
      // Tras deslizar, la mano sigue abierta: no lo confundimos con "palma".
      this.candidato = pose;
      this.tCandidato = t;
      this.posCandidato = centro;
      return;
    }
    // Se exige la mano quieta para que un movimiento (p. ej. deslizar) no dispare gestos.
    // "senalar" es la excepción: al señalar, la mano se mueve a propósito.
    const movido = pose !== "senalar" && distancia2D(centro, this.posCandidato) > this.op.quietudGesto;
    if (pose !== this.candidato || movido) {
      this.candidato = pose;
      this.tCandidato = t;
      this.posCandidato = centro;
      return;
    }
    if (t - this.tCandidato >= this.op.duracionGestoMs && this.candidato !== this.gestoEstable) {
      this.gestoEstable = this.candidato;
      this.emitir({ tipo: "gesto", gesto: this.gestoEstable, t });
    }
  }

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

  private reiniciarSeguimiento(): void {
    this.candidato = "ninguno";
    this.historial = [];
    this.tUltimoSenalar = -Infinity;
    this.ultimoPuntero = null;
    this.ancla = null;
    this.seleccionHecha = false;
    this.fx.reiniciar();
    this.fy.reiniciar();
  }

  private emitir(e: EventoManos): void {
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
