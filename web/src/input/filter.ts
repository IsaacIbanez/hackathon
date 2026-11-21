// "One Euro" filter (Casiez et al., 2012): smooths jitter while the hand is still and follows
// quickly when it moves. Important for users with tremor.

class LowPassFilter {
  private previous: number | null = null;
  filter(value: number, alpha: number): number {
    this.previous = this.previous === null ? value : alpha * value + (1 - alpha) * this.previous;
    return this.previous;
  }
  last(): number | null {
    return this.previous;
  }
  reset(): void {
    this.previous = null;
  }
}

export interface OneEuroOptions {
  /** Minimum cutoff in Hz: lower = smoother at rest. */
  minCutoff: number;
  /** How much the cutoff grows with speed: higher = less lag when moving. */
  beta: number;
  /** Cutoff of the derivative filter in Hz. */
  derivativeCutoff: number;
}

export class OneEuroFilter {
  private x = new LowPassFilter();
  private dx = new LowPassFilter();
  private tPrevious: number | null = null;

  private options: OneEuroOptions;

  constructor(options: OneEuroOptions = { minCutoff: 1.0, beta: 0.007, derivativeCutoff: 1.0 }) {
    this.options = options;
  }

  /** @param t time in milliseconds */
  filter(value: number, t: number): number {
    if (this.tPrevious === null) {
      this.tPrevious = t;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max((t - this.tPrevious) / 1000, 1e-3);
    this.tPrevious = t;
    const previous = this.x.last() ?? value;
    const derivative = this.dx.filter((value - previous) / dt, alpha(this.options.derivativeCutoff, dt));
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(derivative);
    return this.x.filter(value, alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.tPrevious = null;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
