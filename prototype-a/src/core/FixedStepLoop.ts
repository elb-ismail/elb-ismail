// Fixed-step simulation, decoupled from rendering. The render callback receives the interpolation
// factor between the last two simulation steps.

export class FixedStepLoop {
  private acc = 0;
  private last = -1;
  private raf = 0;
  private running = false;
  readonly dt: number;

  constructor(stepHz: number, private step: () => void, private render: (alpha: number, frameSeconds: number) => void, private maxSteps = 5) {
    this.dt = 1 / stepHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance by a wall-clock delta; returns the number of simulation steps run. Exposed for tests. */
  advance(seconds: number): number {
    this.acc += Math.min(seconds, this.dt * this.maxSteps);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) { this.step(); this.acc -= this.dt; n++; }
    return n;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const secs = this.last < 0 ? 0 : (now - this.last) / 1000;
    this.last = now;
    this.advance(secs);
    this.render(this.acc / this.dt, secs);
    this.raf = requestAnimationFrame(this.frame);
  };
}
