// Per-frame lightmap pipeline. The server syncs `gameMinute` on welcome and at
// schedule-keyframe crossings; between syncs the client advances
// `gameMinute` locally using wall-clock × 100 (100× in-game speed).
//
// Each frame, `update(scene)` composes a per-tile RGB lightmap covering a
// window around the player: ambient tint from the day schedule, plus additive
// contributions from any visible light-emitting blueprint (only Campfire for
// now). Walls and other non-walkable tiles block emitted light. The lightmap
// is uploaded to a small 2D texture sampled by the terrain and sprite shaders.
//
// Effects (chat bubbles, damage numbers) skip lightmap sampling via the
// sprite shader's `u_lit = 0` mode — they're UI-ish and should stay bright.

import { INTEREST_RANGE, TICKS_PER_GAME_MINUTE } from '@shared/constants.js';
import { StatusEffect } from '@shared/status-effects.js';
import { getBlueprint } from '@shared/blueprints.js';
import { ambientTint, gameMinuteFromTick } from '@shared/lighting.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { ClientEntity } from '../entities/client-entity.js';
import { shadowcast } from './shadowcast.js';

/** Window side (in tiles). Covers interest range plus a margin so the
 *  origin doesn't have to re-anchor every time the player moves a tile. */
export const LIGHTMAP_SIZE = 2 * INTEREST_RANGE + 16;
/** Re-origin threshold in tiles — when the player drifts more than this from
 *  the window center, we recenter. Chosen so rebuilds are infrequent but the
 *  window never clips at the player's view edge. */
const RECENTER_THRESHOLD = 8;

/** How many real ms equal one in-game minute at the configured 100× speed.
 *  Derived from TICKS_PER_GAME_MINUTE × TICK_MS to stay in sync with server. */
const REAL_MS_PER_GAME_MINUTE = TICKS_PER_GAME_MINUTE * (1000 / 20);

function tileKey(x: number, y: number): number {
  // Pack two nonneg coords into one number; 16 bits per axis is ample
  // given MAP_SIZE=128 today and room to grow.
  return (y << 16) | (x & 0xffff);
}

export class LightingManager {
  readonly texture: WebGLTexture;
  readonly size = LIGHTMAP_SIZE;
  private readonly gl: WebGL2RenderingContext;
  private readonly pixels: Uint8ClampedArray;

  /** Top-left world-tile coordinates of the lightmap window. */
  originX = 0;
  originY = 0;
  private originInitialized = false;

  /** Authoritative minute from last server sync, plus the wall-clock at
   *  which we received it. Local advance uses `performance.now() - receivedAt`. */
  private baseGameMinute = 12 * 60; // Default to noon until first sync.
  private baseReceivedAt = 0;
  weather = 0;
  serverTick = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.pixels = new Uint8ClampedArray(LIGHTMAP_SIZE * LIGHTMAP_SIZE * 3);
    // Start fully lit (white) so pre-first-frame draws are unaffected.
    this.pixels.fill(255);

    const tex = gl.createTexture();
    if (!tex) throw new Error('gl.createTexture returned null');
    this.texture = tex;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGB8,
      LIGHTMAP_SIZE, LIGHTMAP_SIZE, 0,
      gl.RGB, gl.UNSIGNED_BYTE, this.pixels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Snap local clock to server sync. */
  onEnvironmentSync(gameMinute: number, weather: number, serverTick: number, nowMs: number): void {
    this.baseGameMinute = gameMinute;
    this.baseReceivedAt = nowMs;
    this.weather = weather;
    this.serverTick = serverTick;
  }

  /** Current minute-of-day (0..1440, fractional), extrapolated from last sync. */
  currentGameMinute(nowMs: number): number {
    const elapsed = nowMs - this.baseReceivedAt;
    const m = this.baseGameMinute + elapsed / REAL_MS_PER_GAME_MINUTE;
    return ((m % 1440) + 1440) % 1440;
  }

  /** Rebuild the lightmap against the current scene state. Called by the
   *  renderer each frame before terrain/sprite passes. */
  update(
    playerTileX: number,
    playerTileY: number,
    entities: IterableIterator<ClientEntity>,
    worldMap: WorldMap,
    nowMs: number,
  ): void {
    this.maybeReorigin(playerTileX, playerTileY);

    const gameMinute = this.currentGameMinute(nowMs);
    const [ambR, ambG, ambB] = ambientTint(gameMinute);
    const ambR8 = Math.round(ambR * 255);
    const ambG8 = Math.round(ambG * 255);
    const ambB8 = Math.round(ambB * 255);

    // Fill with ambient.
    const px = this.pixels;
    for (let i = 0; i < px.length; i += 3) {
      px[i    ] = ambR8;
      px[i + 1] = ambG8;
      px[i + 2] = ambB8;
    }

    // Build blocker set: entities whose blueprint collides and that aren't
    // open (doors). worldMap.isLightPassing covers terrain + buildings (walls
    // and water/rock block; rivers and floors pass).
    const blockerEntities = new Set<number>();
    const emitters: { tx: number; ty: number; radius: number; color: readonly [number, number, number] }[] = [];
    for (const e of entities) {
      const pos = e.position;
      const bp = e.blueprint ? getBlueprint(e.blueprint.blueprintId) : undefined;
      if (!pos || !bp) continue;
      if (bp.collides) {
        const open = e.statusEffects && (e.statusEffects.effects & StatusEffect.Open) !== 0;
        if (!open) blockerEntities.add(tileKey(pos.tileX, pos.tileY));
      }
      if (bp.lightRadius && bp.lightRadius > 0) {
        emitters.push({
          tx: pos.tileX,
          ty: pos.tileY,
          radius: bp.lightRadius,
          color: bp.lightColor ?? [1.0, 0.8, 0.5],
        });
      }
    }

    const blocks = (x: number, y: number): boolean => {
      if (!worldMap.isLightPassing(x, y)) return true;
      return blockerEntities.has(tileKey(x, y));
    };

    // Shadowcast each emitter that can reach the window.
    for (const em of emitters) {
      // Cheap AABB cull vs window.
      if (em.tx + em.radius < this.originX) continue;
      if (em.ty + em.radius < this.originY) continue;
      if (em.tx - em.radius >= this.originX + LIGHTMAP_SIZE) continue;
      if (em.ty - em.radius >= this.originY + LIGHTMAP_SIZE) continue;

      const r2 = em.radius * em.radius;
      const cR = em.color[0] * 255;
      const cG = em.color[1] * 255;
      const cB = em.color[2] * 255;

      shadowcast({
        originX: em.tx,
        originY: em.ty,
        radius: em.radius,
        blocks,
        visit: (x, y, distSq) => {
          const lx = x - this.originX;
          const ly = y - this.originY;
          if (lx < 0 || ly < 0 || lx >= LIGHTMAP_SIZE || ly >= LIGHTMAP_SIZE) return;
          // Quadratic falloff — softer than linear, hides the radius edge.
          const falloff = 1 - distSq / r2;
          const addR = cR * falloff;
          const addG = cG * falloff;
          const addB = cB * falloff;
          const i = (ly * LIGHTMAP_SIZE + lx) * 3;
          // Additive, clamped by Uint8ClampedArray's saturation.
          px[i    ] = px[i    ] + addR;
          px[i + 1] = px[i + 1] + addG;
          px[i + 2] = px[i + 2] + addB;
        },
      });
    }

    // Upload.
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      LIGHTMAP_SIZE, LIGHTMAP_SIZE,
      gl.RGB, gl.UNSIGNED_BYTE, px,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private maybeReorigin(playerTileX: number, playerTileY: number): void {
    const centerX = this.originX + Math.floor(LIGHTMAP_SIZE / 2);
    const centerY = this.originY + Math.floor(LIGHTMAP_SIZE / 2);
    if (!this.originInitialized
     || Math.abs(playerTileX - centerX) > RECENTER_THRESHOLD
     || Math.abs(playerTileY - centerY) > RECENTER_THRESHOLD) {
      this.originX = Math.floor(playerTileX) - Math.floor(LIGHTMAP_SIZE / 2);
      this.originY = Math.floor(playerTileY) - Math.floor(LIGHTMAP_SIZE / 2);
      this.originInitialized = true;
    }
  }
}
