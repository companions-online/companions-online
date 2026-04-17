import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';

export type EffectKind = 'damage' | 'pickup' | 'chat';

export interface Effect {
  readonly kind: EffectKind;
  readonly startTime: number;
  readonly duration: number;
  done: boolean;
  tick(scene: Scene): void;
  draw(
    sprites: SpriteRenderer,
    gl: WebGL2RenderingContext,
    offsetX: number,
    offsetY: number,
    scene: Scene,
  ): void;
  dispose(gl: WebGL2RenderingContext): void;
}

export class EffectManager {
  active: Effect[] = [];

  spawn(effect: Effect): void {
    this.active.push(effect);
  }

  tick(scene: Scene): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (e.done) continue;

      const elapsed = scene.time - e.startTime;
      if (elapsed >= e.duration) {
        e.done = true;
      } else {
        e.tick(scene);
      }
    }

    // Sweep expired effects in reverse to preserve indices.
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].done) {
        this.active[i].dispose(scene.gl);
        this.active.splice(i, 1);
      }
    }
  }

  draw(
    sprites: SpriteRenderer,
    gl: WebGL2RenderingContext,
    offsetX: number,
    offsetY: number,
    scene: Scene,
    resolution: readonly [number, number],
  ): void {
    if (this.active.length === 0) return;
    sprites.begin(resolution);
    for (const e of this.active) {
      e.draw(sprites, gl, offsetX, offsetY, scene);
    }
    sprites.end();
  }
}
