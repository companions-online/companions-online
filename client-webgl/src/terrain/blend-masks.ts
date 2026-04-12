import { TILE_W, TILE_H } from '../platform/config.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/** Number of mask tiles per blend mode (per docs/client/blendomatic.md). */
export const MASKS_PER_MODE = 31;

/**
 * Blend mode: shape-class of mask edge. The 9 modes in the original blendomatic
 * collapse to ~5 unique shapes; we start with 3 that cover our terrain set.
 *
 * Used as an index into the BlendMaskSet returned by generateBlendMasks().
 */
export enum BlendMode {
  Rough = 0,  // jagged, noise-jittered — grass / dirt / rock
  Smooth = 1, // clean linear gradient — sand / beach
  Short = 2,  // tight high-contrast edge — water / river shore
}

export const BLEND_MODE_COUNT = 3;

type EdgeDir = 'SE' | 'SW' | 'NE' | 'NW';

/**
 * Directional half-diamond weight. Returns a value in [0, 1]:
 * 1 along the named edge, 0 along the opposite edge, linear between.
 *
 * Derivation: for iso coords (nx, ny) with diamond |nx|+|ny| ≤ 1:
 *   SE edge: nx + ny = 1  → weight = (nx + ny + 1) / 2
 *   SW edge: ny - nx = 1  → weight = (-nx + ny + 1) / 2
 *   NE edge: nx - ny = 1  → weight = (nx - ny + 1) / 2
 *   NW edge: -nx - ny = 1 → weight = (-nx - ny + 1) / 2
 */
function edgeWeight(nx: number, ny: number, dir: EdgeDir): number {
  switch (dir) {
    case 'SE': return ( nx + ny + 1) / 2;
    case 'SW': return (-nx + ny + 1) / 2;
    case 'NE': return ( nx - ny + 1) / 2;
    case 'NW': return (-nx - ny + 1) / 2;
  }
}

type Shape = (nx: number, ny: number) => number;

/**
 * Base alpha field for a given mask id. The field is [0, 1] — post-processing
 * (thresholding, noise, falloff) is applied on top per blend mode.
 *
 * Layout (see blendomatic.md):
 *   0..3   lower-right edge (SE), 4 noise variants
 *   4..7   upper-right edge (NE)
 *   8..11  lower-left  edge (SW)
 *   12..15 upper-left  edge (NW)
 *   16     right point (E vertex)
 *   17     down  point (S vertex)
 *   18     up    point (N vertex)
 *   19     left  point (W vertex)
 *   20..25 two-edge unions (opposite pairs + 4 L-shapes)
 *   26..29 three-edge unions ("keep one corner")
 *   30     all four edges
 */
function baseShape(id: number): Shape {
  // Edge masks: same geometry across all 4 variants; variants differ only in
  // the noise seed used by the Rough post-processor.
  if (id < 16) {
    const dir = (['SE', 'NE', 'SW', 'NW'] as const)[Math.floor(id / 4)];
    return (nx, ny) => edgeWeight(nx, ny, dir);
  }

  // Point masks 16..19: peak at one vertex, fall off rapidly.
  // A vertex lies where two adjacent edges meet, so we take the min of those
  // two edge weights — only points near both edges score high.
  if (id < 20) {
    const v = (['E', 'S', 'N', 'W'] as const)[id - 16];
    switch (v) {
      case 'E': return (nx, ny) => Math.min(edgeWeight(nx, ny, 'NE'), edgeWeight(nx, ny, 'SE'));
      case 'S': return (nx, ny) => Math.min(edgeWeight(nx, ny, 'SE'), edgeWeight(nx, ny, 'SW'));
      case 'N': return (nx, ny) => Math.min(edgeWeight(nx, ny, 'NE'), edgeWeight(nx, ny, 'NW'));
      case 'W': return (nx, ny) => Math.min(edgeWeight(nx, ny, 'SW'), edgeWeight(nx, ny, 'NW'));
    }
  }

  // Combination masks 20..30: p-max (p=4) of the constituent edge weights.
  const combos: Record<number, readonly EdgeDir[]> = {
    20: ['NE', 'SW'],              // opposite: upper-right + lower-left
    21: ['SE', 'NW'],              // opposite: lower-right + upper-left
    22: ['SW', 'NW'],              // left pair
    23: ['NE', 'NW'],              // top pair
    24: ['SE', 'SW'],              // bottom pair
    25: ['NE', 'SE'],              // right pair
    26: ['NE', 'SE', 'SW'],        // 3 of 4, keep NW
    27: ['SE', 'SW', 'NW'],        // keep NE
    28: ['NE', 'SW', 'NW'],        // keep SE
    29: ['NE', 'SE', 'NW'],        // keep SW
    30: ['NE', 'SE', 'SW', 'NW'],  // all four
  };
  const dirs = combos[id];
  if (!dirs) throw new Error(`baseShape: invalid mask id ${id}`);
  return (nx, ny) => {
    let sum = 0;
    for (const d of dirs) {
      const w = edgeWeight(nx, ny, d);
      sum += w * w * w * w; // w^4
    }
    return Math.min(1, Math.pow(sum, 0.25));
  };
}

/**
 * Edge-mask threshold per mode — the base-weight value at which a pixel starts
 * becoming opaque. Higher threshold = thinner band hugging the edge.
 */
const EDGE_THRESHOLD: Record<BlendMode, number> = {
  [BlendMode.Rough]: 0.70,
  [BlendMode.Smooth]: 0.50,
  [BlendMode.Short]: 0.55,
};

/** Point-mask threshold — tighter than edge so isolated point neighbors look like specks. */
const POINT_THRESHOLD: Record<BlendMode, number> = {
  [BlendMode.Rough]: 0.85,
  [BlendMode.Smooth]: 0.75,
  [BlendMode.Short]: 0.75,
};

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Generate one mask tile: a 64×32 OffscreenCanvas whose alpha channel is the mask. */
function generateMask(modeId: BlendMode, maskId: number): OffscreenCanvas {
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  const img = ctx.createImageData(TILE_W, TILE_H);
  const data = img.data;

  const shape = baseShape(maskId);
  const isPoint = maskId >= 16 && maskId < 20;
  const threshold = isPoint ? POINT_THRESHOLD[modeId] : EDGE_THRESHOLD[modeId];

  // Per-mask noise source — deterministic per (mode, maskId). Edge masks 0..15
  // share geometry across their 4 variants; different seeds give each variant
  // a distinct rough-noise speckle so repetition breaks up across the map.
  const rand = lcg(maskId * 2654435761 + modeId * 374761393 + 0x9e3779b9);

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      const nx = (px - HALF_W + 0.5) / HALF_W;
      const ny = (py - HALF_H + 0.5) / HALF_H;
      const base = shape(nx, ny);

      let alpha: number;
      switch (modeId) {
        case BlendMode.Rough: {
          // ±0.15 jitter on the base weight, then hard threshold → jagged edge.
          const jitter = (rand() - 0.5) * 0.30;
          alpha = base + jitter >= threshold ? 255 : 0;
          break;
        }
        case BlendMode.Smooth: {
          // Linear ramp from threshold → 1.0.
          const t = (base - threshold) / (1 - threshold);
          alpha = Math.round(Math.max(0, Math.min(1, t)) * 255);
          break;
        }
        case BlendMode.Short: {
          // sqrt ramp — reaches full alpha faster than smooth's linear ramp,
          // giving a tight shore line that still has a soft inner fade.
          const t = (base - threshold) / (1 - threshold);
          const s = Math.max(0, Math.min(1, t));
          alpha = Math.round(Math.sqrt(s) * 255);
          break;
        }
      }

      const i = (py * TILE_W + px) * 4;
      data[i]     = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alpha;
    }
  }

  ctx.putImageData(img, 0, 0);
  return oc;
}

/** Indexed as masks[modeId][maskId]. */
export type BlendMaskSet = OffscreenCanvas[][];

/** Generate the full 3 × 31 set of mask tiles. Call once at scene init. */
export function generateBlendMasks(): BlendMaskSet {
  const result: BlendMaskSet = [];
  for (let m = 0; m < BLEND_MODE_COUNT; m++) {
    const masks: OffscreenCanvas[] = [];
    for (let k = 0; k < MASKS_PER_MODE; k++) {
      masks.push(generateMask(m as BlendMode, k));
    }
    result.push(masks);
  }
  return result;
}
