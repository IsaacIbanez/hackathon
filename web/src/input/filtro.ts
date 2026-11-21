// Filtro "One Euro" (Casiez et al., 2012): suaviza el temblor cuando la mano está
// quieta y sigue rápido cuando se mueve. Importante para usuarios con temblor.

class FiltroPasoBajo {
  private previo: number | null = null;
  filtrar(valor: number, alfa: number): number {
    this.previo = this.previo === null ? valor : alfa * valor + (1 - alfa) * this.previo;
    return this.previo;
  }
  ultimo(): number | null {
    return this.previo;
  }
  reiniciar(): void {
    this.previo = null;
  }
}

export interface OpcionesFiltro {
  /** Corte mínimo en Hz: más bajo = más suave en reposo. */
  minCorte: number;
  /** Cuánto sube el corte con la velocidad: más alto = menos retraso al moverse. */
  beta: number;
  /** Corte del filtro de la derivada en Hz. */
  corteDerivada: number;
}

export class FiltroOneEuro {
  private x = new FiltroPasoBajo();
  private dx = new FiltroPasoBajo();
  private tPrevio: number | null = null;

  private op: OpcionesFiltro;

  constructor(op: OpcionesFiltro = { minCorte: 1.0, beta: 0.007, corteDerivada: 1.0 }) {
    this.op = op;
  }

  /** @param t tiempo en milisegundos */
  filtrar(valor: number, t: number): number {
    if (this.tPrevio === null) {
      this.tPrevio = t;
      this.dx.filtrar(0, 1);
      return this.x.filtrar(valor, 1);
    }
    const dt = Math.max((t - this.tPrevio) / 1000, 1e-3);
    this.tPrevio = t;
    const previo = this.x.ultimo() ?? valor;
    const derivada = this.dx.filtrar((valor - previo) / dt, alfa(this.op.corteDerivada, dt));
    const corte = this.op.minCorte + this.op.beta * Math.abs(derivada);
    return this.x.filtrar(valor, alfa(corte, dt));
  }

  reiniciar(): void {
    this.x.reiniciar();
    this.dx.reiniciar();
    this.tPrevio = null;
  }
}

function alfa(corte: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * corte);
  return 1 / (1 + tau / dt);
}
