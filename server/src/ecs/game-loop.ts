export class GameLoop {
  private tickCount = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTime = 0;

  readonly tickMs: number;

  constructor(readonly tickRate: number) {
    this.tickMs = 1000 / tickRate;
  }

  start(onTick: (tick: number, dt: number) => void): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();

    const loop = () => {
      if (!this.running) return;

      const now = performance.now();
      const elapsed = now - this.lastTime;
      this.lastTime = now;

      this.tickCount++;
      onTick(this.tickCount, elapsed);

      // Drift compensation: adjust next timeout based on how long this tick took
      const tickDuration = performance.now() - now;
      const nextDelay = Math.max(0, this.tickMs - tickDuration);
      this.timer = setTimeout(loop, nextDelay);
    };

    this.timer = setTimeout(loop, this.tickMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get currentTick(): number {
    return this.tickCount;
  }
}
