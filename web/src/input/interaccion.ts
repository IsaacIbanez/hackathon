// Controlador de interacción con las manos: recibe frames con landmarks y emite
// eventos de alto nivel (gesto estable, deslizar, puntero, selección por permanencia y,
// como experimentales, modo dormido/despierto, nivel con la pinza, menú radial y cabeza).
// No depende de MediaPipe ni del DOM: se puede probar con datos sintéticos.

import { DetectorCabeza, type OpcionesCabeza } from "./cabeza.ts";
import { FiltroOneEuro } from "./filtro.ts";
import { aplicarHomografia, distancia2D, homografiaDocumento, media } from "./geometria.ts";
import { alcanceIndice, clasificarPose, puntosParaForma, UMBRALES_POR_DEFECTO, type Umbrales } from "./poses.ts";
import {
  P,
  type Esquinas,
  type EventoManos,
  type FrameManos,
  type Gesto,
  type LadoMano,
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
  /**
   * Invierte la etiqueta de mano de MediaPipe. Probado con webcam: sin invertir, la etiqueta ya
   * coincide con la mano real del usuario, así que por defecto es false.
   */
  invertirLateralidad: boolean;
  umbrales: Umbrales;

  // ---- Experimentales ----
  /** Si es true, se ignoran los gestos hasta "despertar" con la palma abierta mantenida. */
  requiereDespertar: boolean;
  /** Tiempo con la palma abierta y quieta para despertar. */
  despertarMs: number;
  /** Tiempo sin actividad para volver a dormir. */
  dormirMs: number;
  /**
   * Escala del volumen. La medida es simple: distancia EN PANTALLA entre las puntas de pulgar e
   * índice dividida por el tamaño de la mano en pantalla (muñeca → nudillo del corazón), para que no
   * dependa de lo cerca que esté la mano de la cámara. Es la línea que se dibuja.
   * Con esa medida ≤ nivelCero es 0 %, ≥ nivelLleno es 100 %, y en medio, lineal.
   * Para empezar, hay que juntar los dedos hasta la zona del 0 %.
   */
  nivelCero: number;
  nivelLleno: number;
  /** Tamaño del escalón del nivel (0,1 = 0 %, 10 %, 20 %…). */
  pasoNivel: number;
  /** Margen extra (fracción del escalón) para cambiar de escalón: evita saltos en el límite. */
  histeresisNivel: number;
  /** Tiempo quieto en el mismo escalón para confirmar el valor. */
  confirmarNivelMs: number;
  /** Tiempo que hay que mantener la pinza para empezar a controlar el nivel. */
  inicioNivelMs: number;
  /** Tras elegir "ajustar volumen" en el menú, tiempo para juntar los dedos antes de cancelar. */
  esperaNivelMs: number;
  /** Alcance del índice por debajo del cual se considera la mano cerrada (puño). */
  indiceCerrado: number;
  /** Si es false, el puño no se usa: ni se emite como gesto ni termina el ajuste de volumen. */
  usarPuno: boolean;
  /** Si es true, la palma solo cuenta cuando la palma (no el dorso) mira a la cámara. */
  palmaHaciaCamara: boolean;
  /** Tiempo señalando hacia un lado del menú para elegir esa opción. */
  elegirMenuMs: number;
  /** Tras abrir el menú, se ignora la mano durante este tiempo (aún se está colocando). */
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
  invertirLateralidad: false,
  umbrales: UMBRALES_POR_DEFECTO,
  requiereDespertar: false,
  despertarMs: 1000,
  dormirMs: 10000,
  nivelCero: 0.25,
  nivelLleno: 1.0,
  pasoNivel: 0.1,
  histeresisNivel: 0.25,
  confirmarNivelMs: 1000,
  inicioNivelMs: 150,
  indiceCerrado: 0.9,
  esperaNivelMs: 8000,
  usarPuno: false,
  palmaHaciaCamara: true,
  elegirMenuMs: 500,
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
  elegirMenuMs: 900,
  caducidadMenuMs: 8000,
};

type Oyente = (e: EventoManos) => void;

interface EstadoMenu {
  centro: Punto; // imagen, sin aspecto (para dibujar)
  /** Mano con la que se abrió: el lado de esa mano no se puede elegir. */
  mano: LadoMano | null;
  tApertura: number;
  /** Lado hacia el que apunta ahora el índice, y desde cuándo. */
  sector: SectorMenu | null;
  tSector: number;
}

/** Datos crudos del último frame, para mostrarlos en pantalla y calibrar. */
export interface Diagnostico {
  /** Separación pulgar–índice relativa al tamaño de la mano. */
  separacion: number;
  /** Alcance del índice (muñeca→punta / muñeca→nudillo). */
  alcance: number;
  /** Puntas de pulgar e índice en la imagen. */
  pulgar: Punto;
  indice: Punto;
  /** Hacia dónde apunta el índice (desde el punto de vista del usuario), si apunta claramente. */
  direccionIndice: SectorMenu | null;
  /** Mano detectada (estabilizada), o null si aún no está clara. */
  mano: LadoMano | null;
}

interface EstadoNivel {
  /** Valor en escalones (0, 0,1, 0,2…). */
  valor: number;
  /** Valor continuo sin redondear (para mostrar la posición dentro del escalón). */
  continuo: number;
  /** Momento del último cambio de escalón. */
  tCambio: number;
  /** Si el valor ya ha cambiado alguna vez (no se confirma el valor inicial sin tocarlo). */
  movido: boolean;
  /** Valores recientes: al cerrar el puño se usa uno de antes de cerrar la mano. */
  historial: { t: number; valor: number }[];
  tUltimoValido: number;
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
  private diag: Diagnostico | null = null;
  /** Votación suavizada de la mano: >0 derecha, <0 izquierda. */
  private votoMano = 0;
  private manoEstable: LadoMano | null = null;
  private tPinzaInicio: number | null = null;
  private nivel: EstadoNivel | null = null;
  private fSeparacion = new FiltroOneEuro({ minCorte: 1.0, beta: 0.3, corteDerivada: 1.0 });
  /** Tras confirmar un nivel, hay que soltar la pinza antes de empezar otro. */
  private esperarSoltarPinza = false;
  /** Volumen armado desde el menú, a la espera de juntar los dedos (momento en que se armó). */
  private nivelArmado: number | null = null;
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
    const antesInvertir = this.op.invertirLateralidad;
    this.op = { ...this.op, ...op };
    if (op.cabeza) this.cabeza = new DetectorCabeza(this.op.cabeza);
    if (op.invertirLateralidad !== undefined && op.invertirLateralidad !== antesInvertir) {
      this.votoMano = -this.votoMano;
      this.manoEstable = this.manoEstable && (this.manoEstable === "derecha" ? "izquierda" : "derecha");
    }
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

  /** Menú abierto: lado señalado ahora y progreso [0,1] hasta elegirlo. */
  menuAbierto(t: number): { centro: Punto; sector: SectorMenu | null; progreso: number; mano: LadoMano | null } | null {
    const m = this.menu;
    if (!m) return null;
    const progreso = m.sector ? Math.min(1, (t - m.tSector) / this.op.elegirMenuMs) : 0;
    return { centro: m.centro, sector: m.sector, progreso, mano: m.mano };
  }

  /** Mano que está usando el usuario (estabilizada en varios frames), o null si no está clara. */
  get manoUsada(): LadoMano | null {
    return this.manoEstable;
  }

  /** Lados del menú que se pueden elegir con la mano actual (se quita el de la mano). */
  sectoresMenu(mano: LadoMano | null = this.menu?.mano ?? this.manoEstable): SectorMenu[] {
    const todos: SectorMenu[] = ["arriba", "derecha", "abajo", "izquierda"];
    return todos.filter((s) => s !== mano);
  }

  /** Medidas crudas del último frame con mano (null si no hay mano). */
  get diagnostico(): Diagnostico | null {
    return this.diag;
  }

  /**
   * Control de nivel activo: valor en escalones, valor continuo, progreso [0,1] de la confirmación
   * por quietud y puntas de pulgar e índice (imagen) para dibujar la línea.
   */
  nivelActivo(t: number): {
    valor: number;
    continuo: number;
    progresoConfirmar: number;
    pulgar: Punto;
    indice: Punto;
  } | null {
    const n = this.nivel;
    if (!n) return null;
    const progresoConfirmar = n.movido ? Math.min(1, (t - n.tCambio) / this.op.confirmarNivelMs) : 0;
    return { valor: n.valor, continuo: n.continuo, progresoConfirmar, pulgar: n.pulgar, indice: n.indice };
  }

  /**
   * Arma el ajuste de volumen (se llama al elegir "ajustar volumen" en el menú). A partir de ahí,
   * juntar las puntas de pulgar e índice empieza el ajuste. Fuera de esto, la pinza no hace nada.
   */
  iniciarNivel(t: number = this.tUltimaMano): void {
    if (this.nivel) return;
    this.nivelArmado = t;
    this.tPinzaInicio = null;
    this.esperarSoltarPinza = false;
    this.ultimoPuntero = null;
    this.emitir({ tipo: "nivel", fase: "esperar", valor: 0, t });
  }

  /** true mientras el volumen está armado esperando a que se junten los dedos. */
  get nivelEsperando(): boolean {
    return this.nivelArmado !== null;
  }

  /** Medida que es 0 % y medida que es 100 %. */
  get escalaNivel(): { cero: number; lleno: number } {
    return { cero: this.op.nivelCero, lleno: this.op.nivelLleno };
  }

  /**
   * Calibración guiada: medida con los dedos juntos y abiertos del todo. Se deja un pequeño margen
   * hacia dentro para que el 0 % y el 100 % se alcancen sin esfuerzo.
   */
  fijarEscalaNivel(juntos: number, abiertos: number): void {
    const margen = 0.1 * (abiertos - juntos);
    this.configurar({ nivelCero: juntos + margen, nivelLleno: abiertos - margen });
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
      this.diag = null;
      if (this.presente && t - this.tUltimaMano > this.op.perdidaManoMs) {
        this.presente = false;
        this.terminarNivel(t);
        this.cancelarNivelArmado(t);
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

    let pose = clasificarPose(mano, aspecto, this.op.umbrales);
    if (pose === "palma" && this.op.palmaHaciaCamara && palmaHaciaCamara(mano, this.ladoDe(mano)) === false) {
      pose = "ninguno"; // es el dorso de la mano
    }
    if (pose === "puno" && !this.op.usarPuno) pose = "ninguno";
    this.poseActual = pose;
    const centro = centroPalma(mano, aspecto);
    const pts = puntosParaForma(mano, aspecto);
    this.actualizarLateralidad(mano);
    this.diag = {
      separacion: separacionEnPantalla(mano, aspecto),
      alcance: alcanceIndice(pts),
      pulgar: { x: mano.puntos[P.PULGAR_PUNTA].x, y: mano.puntos[P.PULGAR_PUNTA].y },
      indice: { x: mano.puntos[P.INDICE_PUNTA].x, y: mano.puntos[P.INDICE_PUNTA].y },
      direccionIndice: direccionIndice(mano, aspecto, this.op.espejo),
      mano: this.manoEstable,
    };

    if (!this.despierto) {
      this.intentarDespertar(t, pose, centro);
      return;
    }
    if (this.menu) {
      this.actualizarMenu(t, pose, centro, mano);
      return;
    }
    if (this.actualizarNivel(t, pose, centro)) return;

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

    const p = this.punteroIndice(t, mano);
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
   * Volumen con la pinza (solo después de elegir "ajustar volumen" en el menú):
   * 1. Se empieza juntando las puntas de pulgar e índice hasta la zona del 0 % (~0,15 s).
   * 2. El valor es la medida de la línea pulgar–índice entre nivelCero (0 %) y nivelLleno (100 %),
   *    redondeado a escalones de 10 %.
   * 3. Se confirma quedándose quieto ~1 s en el mismo valor (o cerrando el puño, si usarPuno).
   * Devuelve true si el frame lo ha consumido el control de volumen.
   */
  private actualizarNivel(t: number, pose: Gesto, centro: Punto): boolean {
    const diag = this.diag!;
    const juntos = diag.separacion <= this.op.nivelCero && diag.alcance >= this.op.umbrales.indiceFuera;
    if (!this.nivel) {
      if (this.nivelArmado === null) return false; // la pinza sola no hace nada
      if (t - this.nivelArmado > this.op.esperaNivelMs) {
        this.cancelarNivelArmado(t);
        return false;
      }
      if (!juntos) {
        this.tPinzaInicio = null;
        return true; // armado: el resto de gestos esperan
      }
      this.tPinzaInicio ??= t;
      if (t - this.tPinzaInicio < this.op.inicioNivelMs) return true;
      this.tPinzaInicio = null;
      this.nivelArmado = null;
      this.fSeparacion.reiniciar();
    } else if (this.op.usarPuno && diag.alcance < this.op.indiceCerrado) {
      // Puño: termina. Toleramos fallos breves de la detección.
      if (t - this.nivel.tUltimoValido <= 200) return true;
      this.terminarNivel(t, true);
      this.reiniciarCandidato(t, pose, centro);
      return false;
    }

    const sep = this.fSeparacion.filtrar(diag.separacion, t);
    const { nivelCero, nivelLleno } = this.op;
    const continuo = Math.min(1, Math.max(0, (sep - nivelCero) / (nivelLleno - nivelCero || 1)));
    const { pulgar, indice } = diag;
    this.ultimoPuntero = null;

    if (!this.nivel) {
      const valor = redondearNivel(continuo, this.op.pasoNivel);
      this.nivel = {
        valor,
        continuo,
        tCambio: t,
        movido: false,
        historial: [{ t, valor }],
        tUltimoValido: t,
        pulgar,
        indice,
      };
      this.emitir({ tipo: "nivel", fase: "inicio", valor, t });
      return true;
    }

    const n = this.nivel;
    n.continuo = continuo;
    n.pulgar = pulgar;
    n.indice = indice;
    n.tUltimoValido = t;
    // Histéresis: solo se cambia de escalón al entrar claramente en el siguiente.
    const paso = this.op.pasoNivel;
    if (Math.abs(continuo - n.valor) > paso * (0.5 + this.op.histeresisNivel)) {
      n.valor = redondearNivel(continuo, paso);
      n.tCambio = t;
      n.movido = true;
      this.emitir({ tipo: "nivel", fase: "mover", valor: n.valor, t });
    }
    n.historial.push({ t, valor: n.valor });
    while (n.historial.length && t - n.historial[0].t > 400) n.historial.shift();

    // Confirmar: quieto en el mismo escalón el tiempo indicado.
    if (n.movido && t - n.tCambio >= this.op.confirmarNivelMs) {
      this.terminarNivel(t, false);
      this.gestoEstable = pose;
      this.reiniciarCandidato(t, pose, centro);
    }
    return true;
  }

  private cancelarNivelArmado(t: number): void {
    if (this.nivelArmado === null) return;
    this.nivelArmado = null;
    this.tPinzaInicio = null;
    this.emitir({ tipo: "nivel", fase: "cancelar", valor: 0, t });
  }

  /** @param alCerrar true si termina por cerrar el puño o perder la mano (se usa el valor de antes). */
  private terminarNivel(t: number, alCerrar = true): void {
    const n = this.nivel;
    if (!n) return;
    this.nivel = null;
    // Al cerrar la mano, pulgar e índice se mueven: nos quedamos con el valor de ~0,3 s antes.
    const valor = alCerrar
      ? (n.historial.find((h) => h.t >= n.tUltimoValido - 300) ?? n.historial[0])?.valor ?? n.valor
      : n.valor;
    this.emitir({ tipo: "nivel", fase: "fin", valor, t });
  }

  // ---------- Experimental: menú radial ----------

  private abrirMenu(t: number, mano: Mano, aspecto: number): void {
    const c = centroPalma(mano, aspecto);
    const centro = { x: c.x / aspecto, y: c.y };
    const manoMenu = this.manoEstable;
    this.menu = { centro, mano: manoMenu, tApertura: t, sector: null, tSector: t };
    this.ultimoPuntero = null;
    this.emitir({ tipo: "menu", fase: "abrir", sector: null, centro, mano: manoMenu, t });
  }

  /**
   * Con el menú abierto, se señala con ☝️ y el puntero (la punta del índice) se lleva encima de una
   * opción, manteniéndolo ~0,5 s. Las opciones ocupan las zonas de la pantalla en cruz (tercios):
   * arriba-centro, abajo-centro, izquierda-centro y derecha-centro, vistas por el usuario.
   */
  private actualizarMenu(t: number, pose: Gesto, centro: Punto, mano: Mano): void {
    const m = this.menu!;
    if (t - m.tApertura > this.op.caducidadMenuMs) {
      this.cerrarMenu(t);
      return;
    }
    if (t - m.tApertura < this.op.esperaMenuMs) return;

    // Solo con ☝️ hay puntero (con ✌️, con el que se abre, no se elige nada).
    if (pose === "senalar") this.tUltimoSenalar = t;
    let sector: SectorMenu | null = null;
    if (t - this.tUltimoSenalar <= 150) {
      const p = this.punteroIndice(t, mano);
      this.ultimoPuntero = p;
      sector = sectorEnPantalla(p, this.op.espejo);
      // El lado de la mano que se usa no existe en el menú.
      if (sector === m.mano) sector = null;
    } else {
      this.ultimoPuntero = null;
      this.fx.reiniciar();
      this.fy.reiniciar();
    }

    if (sector !== m.sector) {
      m.sector = sector;
      m.tSector = t;
      this.emitir({ tipo: "menu", fase: "resaltar", sector, centro: m.centro, mano: m.mano, t });
      return;
    }
    if (sector && t - m.tSector >= this.op.elegirMenuMs) {
      this.menu = null;
      this.ultimoPuntero = null;
      this.emitir({ tipo: "menu", fase: "elegir", sector, centro: m.centro, mano: m.mano, t });
      // Hay que cambiar de pose antes de que "señalar" haga otra cosa.
      this.gestoEstable = pose;
      this.reiniciarCandidato(t, pose, centro);
      this.tUltimoSenalar = -Infinity;
      this.ancla = null;
      this.seleccionHecha = true; // que la permanencia no dispare además un "seleccionar"
    }
  }

  /** Punta del índice (un poco adelantada) filtrada contra el temblor. */
  private punteroIndice(t: number, mano: Mano): Punto {
    const punta = mano.puntos[P.INDICE_PUNTA];
    const dip = mano.puntos[P.INDICE_DIP];
    return {
      x: this.fx.filtrar(punta.x + (punta.x - dip.x) * this.op.adelantoPuntero, t),
      y: this.fy.filtrar(punta.y + (punta.y - dip.y) * this.op.adelantoPuntero, t),
    };
  }

  private cerrarMenu(t: number): void {
    if (!this.menu) return;
    const { centro, mano } = this.menu;
    this.menu = null;
    this.emitir({ tipo: "menu", fase: "cerrar", sector: null, centro, mano, t });
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

  // ---------- Mano usada ----------

  /** Mano de este frame: la estabilizada si la hay; si no, la etiqueta del propio frame. */
  private ladoDe(mano: Mano): LadoMano | null {
    if (this.manoEstable) return this.manoEstable;
    if (mano.lateralidad !== "Left" && mano.lateralidad !== "Right") return null;
    return (mano.lateralidad === "Right") !== this.op.invertirLateralidad ? "derecha" : "izquierda";
  }

  /** Votación suavizada: un frame mal etiquetado no cambia la mano. */
  private actualizarLateralidad(mano: Mano): void {
    const etiqueta = mano.lateralidad;
    if (etiqueta !== "Left" && etiqueta !== "Right") return;
    const esDerecha = (etiqueta === "Right") !== this.op.invertirLateralidad;
    const peso = mano.confianza ?? 0.5;
    this.votoMano = 0.9 * this.votoMano + 0.1 * (esDerecha ? peso : -peso);
    if (this.votoMano > 0.3) this.manoEstable = "derecha";
    else if (this.votoMano < -0.3) this.manoEstable = "izquierda";
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

/**
 * Hacia dónde apunta el índice (de su nudillo a su punta), desde el punto de vista del usuario.
 * null si el dedo apunta en diagonal o hacia la cámara (la dirección no está clara).
 */
export function direccionIndice(mano: Mano, aspecto: number, espejo: boolean): SectorMenu | null {
  const base = mano.puntos[P.INDICE_MCP];
  const punta = mano.puntos[P.INDICE_PUNTA];
  const dxImagen = (punta.x - base.x) * aspecto;
  const dx = espejo ? -dxImagen : dxImagen;
  const dy = punta.y - base.y;
  const largo = Math.hypot(dx, dy);
  // Si el dedo apunta hacia la cámara, en la imagen se ve muy corto.
  const palma = distancia2D(mano.puntos[P.MUNECA], mano.puntos[P.INDICE_MCP], aspecto) || 1;
  if (largo < 0.35 * palma) return null;
  if (Math.abs(dx) > 1.3 * Math.abs(dy)) return dx > 0 ? "derecha" : "izquierda";
  if (Math.abs(dy) > 1.3 * Math.abs(dx)) return dy > 0 ? "abajo" : "arriba";
  return null;
}

/**
 * ¿Mira la palma (no el dorso) a la cámara? Con la imagen sin espejo, en una mano derecha con la
 * palma hacia la cámara el índice queda a la derecha de la imagen y el meñique a la izquierda; en
 * la izquierda, al revés. El signo del producto vectorial muñeca→índice × muñeca→meñique lo dice
 * (y no cambia al girar la mano en el plano). null si no se sabe qué mano es.
 */
export function palmaHaciaCamara(mano: Mano, lado: LadoMano | null): boolean | null {
  if (!lado) return null;
  const m = mano.puntos[P.MUNECA];
  const i = mano.puntos[P.INDICE_MCP];
  const k = mano.puntos[P.MENIQUE_MCP];
  const cruz = (i.x - m.x) * (k.y - m.y) - (i.y - m.y) * (k.x - m.x);
  return lado === "derecha" ? cruz < 0 : cruz > 0;
}

/**
 * Distancia en pantalla entre las puntas de pulgar e índice, dividida por el tamaño de la mano en
 * pantalla (muñeca → nudillo del corazón). Es exactamente la línea que se ve dibujada.
 */
export function separacionEnPantalla(mano: Mano, aspecto: number): number {
  const p = mano.puntos;
  const tam = distancia2D(p[P.MUNECA], p[P.CORAZON_MCP], aspecto) || 1;
  return distancia2D(p[P.PULGAR_PUNTA], p[P.INDICE_PUNTA], aspecto) / tam;
}

/**
 * Opción del menú bajo el puntero: la pantalla (vista por el usuario) se divide en tercios y las
 * opciones están en cruz. Fuera de esas 4 zonas, ninguna.
 */
export function sectorEnPantalla(p: Punto, espejo: boolean): SectorMenu | null {
  const x = espejo ? 1 - p.x : p.x;
  const col = Math.floor(Math.min(0.999, Math.max(0, x)) * 3);
  const fila = Math.floor(Math.min(0.999, Math.max(0, p.y)) * 3);
  if (col === 1 && fila === 0) return "arriba";
  if (col === 1 && fila === 2) return "abajo";
  if (col === 0 && fila === 1) return "izquierda";
  if (col === 2 && fila === 1) return "derecha";
  return null;
}

function redondearNivel(v: number, paso: number): number {
  return Math.min(1, Math.max(0, Number((Math.round(v / paso) * paso).toFixed(4))));
}

/** Centro de la palma en la imagen, con x corregida por aspecto (unidades de alto). */
function centroPalma(mano: Mano, aspecto: number): Punto {
  const c = media(
    [P.MUNECA, P.INDICE_MCP, P.CORAZON_MCP, P.ANULAR_MCP, P.MENIQUE_MCP].map((i) => mano.puntos[i]),
  );
  return { x: c.x * aspecto, y: c.y };
}
