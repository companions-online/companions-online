// Autopilot driver for observer-mode camera. Pure state + a `tick(now)`
// the renderer calls each frame.
//
// Behavior: 8-direction random walk over the map. Direction holds for
// 3-5s (`min/maxSegmentMs`) then re-rolls. An edge buffer keeps the
// camera away from the void; entering the buffer band immediately
// re-rolls the direction biased toward the map center.
//
// The autopilot writes float tile coords into `scene.observerFocus` every
// frame so the camera follow is smooth (mirroring how the player path uses
// `entity.visualX/visualY`). The `setFocus` callback — which drives
// server-side chunk streaming — fires only when the *rounded* tile actually
// changes, keeping streaming churn proportional to camera motion, not RAF
// rate. Rounding the focus before camera follow caused per-axis rounding
// boundaries to fire at staggered times during diagonal motion, producing a
// visible high-frequency screen-zigzag (e.g. NE-tile motion = pure-right on
// screen, but Math.round(posX) and Math.round(posY) crossing .5 boundaries
// at different moments turned that into ↘↗↘↗ jumps).

import { DX, DY } from '@shared/direction.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { Scene } from '../scene.js';

export interface ObserverCameraOpts {
  /** Pan speed in tiles per real-world second. Default 1.5. */
  speedTilesPerSec?: number;
  /** Min ms between direction changes (random in [min,max]). Default 3000. */
  minSegmentMs?: number;
  /** Max ms between direction changes. Default 5000. */
  maxSegmentMs?: number;
  /** Tiles of buffer at every edge — camera never enters this band; a
   *  re-roll fires biased toward the map center on entry. Default 16. */
  edgeBuffer?: number;
  /** RNG seed for reproducibility. Default `Date.now()`. */
  seed?: number;
}

export interface ObserverCamera {
  /** Step the autopilot. Call once per RAF frame; nowMs is the RAF
   *  timestamp (or any monotonic ms clock; tests pass synthetic values). */
  tick(nowMs: number): void;
  stop(): void;
}

/** Mulberry32 — 4-line LCG returning [0,1). Used for reproducible-by-seed
 *  direction picks; the plain `Math.random()` would be fine in production
 *  but seedable RNG makes the autopilot test deterministic. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startObserverCamera(
  scene: Scene,
  setFocus: (tileX: number, tileY: number) => void,
  startTileX: number,
  startTileY: number,
  opts: ObserverCameraOpts = {},
): ObserverCamera {
  const speed = opts.speedTilesPerSec ?? 1.5;
  const minSeg = opts.minSegmentMs ?? 3000;
  const maxSeg = opts.maxSegmentMs ?? 5000;
  const edgeBuffer = opts.edgeBuffer ?? 16;
  const rng = makeRng(opts.seed ?? Date.now());

  let posX = startTileX;
  let posY = startTileY;
  let dirIdx = Math.floor(rng() * 8) % 8;
  let lastTickMs = -1;
  let changeAtMs = 0;
  let lastSentTileX = Math.round(posX);
  let lastSentTileY = Math.round(posY);
  let stopped = false;

  function randSegment(): number {
    return minSeg + rng() * (maxSeg - minSeg);
  }

  /** Pick the 8-direction whose (DX,DY) most closely points from `(x,y)`
   *  toward the map center. Largest-dot-product wins; deterministic. */
  function pickDirTowardCenter(x: number, y: number): number {
    const cx = MAP_SIZE / 2;
    const cy = MAP_SIZE / 2;
    const tx = cx - x;
    const ty = cy - y;
    let bestIdx = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 8; i++) {
      const dot = DX[i] * tx + DY[i] * ty;
      if (dot > bestDot) { bestDot = dot; bestIdx = i; }
    }
    return bestIdx;
  }

  /** Pick a random direction, preferring something different from `prev`
   *  so segments visibly turn (cheap retry; cap to avoid pathological
   *  loops on a degenerate RNG). */
  function pickRandomDir(prev: number): number {
    for (let i = 0; i < 4; i++) {
      const d = Math.floor(rng() * 8) % 8;
      if (d !== prev) return d;
    }
    return (prev + 1) % 8;
  }

  function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function pushFocus(): void {
    scene.observerFocus = { tileX: posX, tileY: posY };
    const tx = Math.round(posX);
    const ty = Math.round(posY);
    if (tx !== lastSentTileX || ty !== lastSentTileY) {
      setFocus(tx, ty);
      lastSentTileX = tx;
      lastSentTileY = ty;
    }
  }

  return {
    tick(nowMs: number) {
      if (stopped) return;
      if (lastTickMs < 0) {
        lastTickMs = nowMs;
        changeAtMs = nowMs + randSegment();
        pushFocus();
        // First tick: also force the initial setFocus to fire even if
        // lastSentTileX/Y match (they were initialized to start coords).
        setFocus(lastSentTileX, lastSentTileY);
        return;
      }
      const dt = (nowMs - lastTickMs) / 1000;
      lastTickMs = nowMs;

      posX += DX[dirIdx] * speed * dt;
      posY += DY[dirIdx] * speed * dt;

      const inEdge = posX < edgeBuffer || posX > MAP_SIZE - edgeBuffer ||
                     posY < edgeBuffer || posY > MAP_SIZE - edgeBuffer;
      if (inEdge) {
        // Clamp first so the toward-center calc uses an in-band point.
        posX = clamp(posX, edgeBuffer, MAP_SIZE - edgeBuffer);
        posY = clamp(posY, edgeBuffer, MAP_SIZE - edgeBuffer);
        dirIdx = pickDirTowardCenter(posX, posY);
        changeAtMs = nowMs + randSegment();
      } else if (nowMs >= changeAtMs) {
        dirIdx = pickRandomDir(dirIdx);
        changeAtMs = nowMs + randSegment();
      }

      pushFocus();
    },
    stop() {
      stopped = true;
    },
  };
}
