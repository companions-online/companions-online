// Generic one-shot sprite animation effect. Plays an EffectSheet through a
// frame sequence at a fixed total duration, then marks itself done.
// Parallel to damage-number/pickup-text/chat-bubble — same Effect interface.

import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { Effect } from './effect.js';
import type { EffectSheet } from './effect-sprites.js';

export interface SpriteAnimOpts {
  sheet: EffectSheet;
  /** Tile-space anchor (fractional allowed). Drawn centered on this tile. */
  anchorX: number;
  anchorY: number;
  /** Optional entity id to follow each tick; if the entity vanishes, anchor
   *  stays at its last known position. */
  followEntityId?: number;
  /** When the effect was spawned (scene.time). */
  startTime: number;
  /** Total playback duration in ms; frames spaced evenly across it. */
  totalDurationMs: number;
  /** Explicit frame indices in playback order. Defaults to 0..frameCount-1. */
  frameSequence?: number[];
  /** Vertical pixel offset above the tile center (positive = up). */
  screenOffsetY?: number;
  /** Draw scale multiplier on the source frame size. Default 1. */
  scale?: number;
  /** Alpha multiplier. Default 1. */
  alpha?: number;
}

export function createSpriteAnim(opts: SpriteAnimOpts): Effect {
  const { sheet, startTime, totalDurationMs } = opts;
  const sequence = opts.frameSequence ?? Array.from({ length: sheet.frameCount }, (_, i) => i);
  const frameMs = totalDurationMs / sequence.length;
  const offsetY = opts.screenOffsetY ?? 0;
  const scale = opts.scale ?? 1;
  const alpha = opts.alpha ?? 1;

  let anchorX = opts.anchorX;
  let anchorY = opts.anchorY;

  // Normalized UV step per frame slice in sheet space.
  const uvW = sheet.frameW / sheet.sheetW;
  const uvH = sheet.frameH / sheet.sheetH;

  return {
    kind: 'sprite-anim',
    startTime,
    duration: totalDurationMs,
    done: false,

    tick(scene) {
      if (opts.followEntityId !== undefined) {
        const e = scene.entities.get(opts.followEntityId);
        if (e) {
          anchorX = e.visualX;
          anchorY = e.visualY;
        }
      }
    },

    draw(sprites, gl, sceneOffsetX, sceneOffsetY, _scene) {
      const elapsed = _scene.time - startTime;
      let idx = Math.floor(elapsed / frameMs);
      if (idx >= sequence.length) idx = sequence.length - 1;
      if (idx < 0) idx = 0;
      const frame = sequence[idx];
      const col = frame % sheet.cols;
      const row = Math.floor(frame / sheet.cols);

      const dstW = sheet.frameW * scale;
      const dstH = sheet.frameH * scale;
      const scr = tileToScreen(anchorX, anchorY, TILE_W, TILE_H);
      const dstX = scr.screenX + sceneOffsetX + TILE_W / 2 - dstW / 2;
      const dstY = scr.screenY + sceneOffsetY - offsetY - dstH / 2;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sheet.texture);
      if (alpha !== 1) sprites.setAlpha(alpha);
      sprites.drawSprite(
        dstX, dstY, dstW, dstH,
        col * uvW, row * uvH, uvW, uvH,
      );
      if (alpha !== 1) sprites.setAlpha(1);
    },

    dispose(_gl) {
      // Shared texture — do not delete here.
    },
  };
}
