import { TILE_W, TILE_H, TERRAIN_COUNT, TERRAIN_VARIANT_COUNTS, WATER_ANIM_FRAMES, SHOW_TILE_OUTLINES } from '../platform/config.js';
import { PerlinNoise } from '@shared/world/noise.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

// ---------------------------------------------------------------------------
// Deterministic pixel-order randomness — used for static fine-grain noise and
// for "sprinkled" features (tufts, pebbles). Each (terrain, variant, frame)
// gets its own sequence so variants diverge but stay reproducible across runs.
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Diamond-interior test — still exported so blend-masks.ts can use it. */
export function isInsideDiamond(px: number, py: number): boolean {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H <= 1.0;
}

/** Normalised distance from centre to diamond edge (0 = centre, 1 = edge). */
export function diamondEdgeDist(px: number, py: number): number {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Per-variant base colour offset. Stacks ON TOP of the world-coords vertex
// shade — these are small per-tile hue shifts to break the "every variant
// looks identical at game zoom" feel, while the shade grid handles the big
// continuous variation across the map.
// Asymmetric pattern so neighbouring tiles (which use neighbouring variant
// ids via tileVariant's hash) tend to land on different tints.
// ---------------------------------------------------------------------------

const VARIANT_TINTS: readonly [number, number, number][] = [
  [  0,  0,  0],
  [  6, -4,  2],
  [ -4,  6, -2],
  [  2, -2,  6],
  [ -2,  2, -6],
  [  4, -6,  4],
];

function variantTint(variant: number): [number, number, number] {
  return VARIANT_TINTS[variant % VARIANT_TINTS.length];
}

// ---------------------------------------------------------------------------
// Per-(terrain, variant, frame) Perlin instances. Pre-allocating once means
// we don't pay construction cost inside the hot pixel loop, and different
// variants get genuinely different noise fields (not just UV-offset views of
// the same field).
// ---------------------------------------------------------------------------

const NOISE_CACHE = new Map<number, PerlinNoise>();
function getNoise(terrain: number, variant: number): PerlinNoise {
  // Key is stable across frames so water animation scrolls through one field.
  const key = terrain * 256 + variant;
  let n = NOISE_CACHE.get(key);
  if (!n) {
    n = new PerlinNoise(key * 2654435761 + 0x9e3779b9);
    NOISE_CACHE.set(key, n);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Per-terrain generator functions.
//
// Each takes the usual context and writes an RGB triple. Inputs:
//   px, py    : pixel coordinates inside the tile rectangle (0..TILE_W-1, 0..TILE_H-1)
//   noise     : a PerlinNoise instance unique to (terrain, variant)
//   rand      : deterministic pixel-order rand() for sprinkled features
//   variant   : 0..variantCount-1 — used to offset sample coords so variants
//               of the same terrain look distinct even with the same noise
//   frame     : 0..WATER_ANIM_FRAMES-1 — only used by water/river for UV scroll
//
// Feature placement that should ANIMATE (water highlights) must derive its
// position from the noise field. Feature placement that's STATIC (grass tufts,
// dirt pebbles) should use `rand()` — that gives a stable per-pixel decision
// that's the same across frames (non-animated terrains only ever pass frame=0).
// ---------------------------------------------------------------------------

type GeneratorFn = (
  px: number, py: number,
  noise: PerlinNoise,
  rand: () => number,
  variant: number,
  frame: number,
) => [number, number, number];

function generateGrass(
  px: number, py: number,
  noise: PerlinNoise,
  rand: () => number,
  variant: number,
  _frame: number,
): [number, number, number] {
  // Two-octave Perlin: broad colour variation (freq ~3 blobs/tile) plus
  // mid-frequency detail. Variant offset pushes the sample window so each
  // variant sits in a different slice of noise space.
  const vx = variant * 17.3;
  const vy = variant * 11.7;
  const lowFreq  = noise.noise2d(px / 20 + vx, py / 10 + vy);       // large blobs
  const midFreq  = noise.noise2d(px / 7  + vx, py / 4  + vy) * 0.5; // grass blades clumps
  const blob = lowFreq + midFreq;

  let r = 56  + blob * 14;
  let g = 110 + blob * 26;
  let b = 42  + blob * 10;

  // Fine per-pixel grain so it doesn't read as smooth gradients at close zoom.
  const grain = rand() - 0.5;
  r += grain * 6;
  g += grain * 12;
  b += grain * 6;

  // Tufts — ~3% of pixels get a bright-green bump. Static across frames.
  const sprinkle = rand();
  if (sprinkle < 0.03) {
    r += 10;
    g += 30;
    b += 6;
  } else if (sprinkle < 0.05) {
    // Darker shadow tufts
    r -= 6;
    g -= 16;
    b -= 4;
  }

  // Rare flowers — tiny yellow/white specks
  if (rand() < 0.003) {
    r = 220; g = 210; b = 90;
  }

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

function generateDirt(
  px: number, py: number,
  noise: PerlinNoise,
  rand: () => number,
  variant: number,
  _frame: number,
): [number, number, number] {
  const vx = variant * 13.3;
  const vy = variant * 19.7;
  const lowFreq = noise.noise2d(px / 18 + vx, py / 9 + vy);
  const midFreq = noise.noise2d(px / 6  + vx, py / 3 + vy) * 0.4;
  const blob = lowFreq + midFreq;

  let r = 118 + blob * 22;
  let g = 88  + blob * 16;
  let b = 54  + blob * 10;

  const grain = rand() - 0.5;
  r += grain * 10;
  g += grain * 8;
  b += grain * 6;

  // Pebbles — darker specks clustering where the noise is low (crevices feel).
  if (blob < -0.3 && rand() < 0.25) {
    r -= 24;
    g -= 18;
    b -= 12;
  }
  // Bright dry patches
  if (blob > 0.4 && rand() < 0.15) {
    r += 14;
    g += 12;
    b += 8;
  }

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

function generateRock(
  px: number, py: number,
  noise: PerlinNoise,
  rand: () => number,
  variant: number,
  _frame: number,
): [number, number, number] {
  const vx = variant * 23.1;
  const vy = variant * 29.3;
  // Larger low-freq contrast than dirt — rock should read as chunky.
  const low  = noise.noise2d(px / 14 + vx, py / 7  + vy);
  const mid  = noise.noise2d(px / 5  + vx, py / 3  + vy) * 0.35;
  const blob = low + mid;

  let r = 108 + blob * 30;
  let g = 104 + blob * 28;
  let b = 100 + blob * 26;

  const grain = rand() - 0.5;
  r += grain * 12;
  g += grain * 12;
  b += grain * 12;

  // Boulder clusters — where low noise is very positive, brighten hard.
  if (low > 0.45) {
    r += 20;
    g += 18;
    b += 16;
  }
  // Dark cracks — where low noise is very negative, darken hard.
  if (low < -0.45) {
    r -= 28;
    g -= 26;
    b -= 24;
  }
  // Mineral flecks
  if (rand() < 0.01) {
    r += 45;
    g += 42;
    b += 38;
  }

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

function generateSand(
  px: number, py: number,
  noise: PerlinNoise,
  rand: () => number,
  variant: number,
  _frame: number,
): [number, number, number] {
  const vx = variant * 7.7;
  const vy = variant * 13.1;
  // Gentle low-freq colour variation.
  const blob = noise.noise2d(px / 24 + vx, py / 12 + vy);

  // Directional ripple lines — a sinusoid at higher frequency along a diagonal.
  // Offset phase by the low-freq noise so the ripples wave around instead of
  // being perfectly parallel.
  const ripplePhase = (px * 0.55 + py * 0.25) + blob * 1.5;
  const ripple = Math.sin(ripplePhase) * 0.5 + 0.5; // [0, 1]

  let r = 196 + blob * 10 + (ripple - 0.5) * 14;
  let g = 180 + blob * 8  + (ripple - 0.5) * 12;
  let b = 130 + blob * 6  + (ripple - 0.5) * 8;

  const grain = rand() - 0.5;
  r += grain * 6;
  g += grain * 5;
  b += grain * 4;

  // Rare bright sparkles
  if (rand() < 0.006) {
    r += 30;
    g += 28;
    b += 20;
  }

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

function generateWater(
  px: number, py: number,
  noise: PerlinNoise,
  _rand: () => number,
  variant: number,
  frame: number,
): [number, number, number] {
  // Scroll the sample coordinates with the frame index — this is what makes
  // the caustic pattern visibly flow between frames. Horizontal + slow
  // vertical gives a gentle "ocean ripple" feel.
  const scrollX = frame * 1.2;
  const scrollY = frame * 0.35;
  const vx = variant * 9.1;
  const vy = variant * 17.3;

  const low  = noise.noise2d(px / 18 + vx + scrollX, py / 9 + vy + scrollY);
  const high = noise.noise2d(px / 6  + vx - scrollX, py / 3 + vy + scrollY) * 0.4;
  const caustic = low + high;

  let r = 28 + caustic * 14;
  let g = 70 + caustic * 26;
  let b = 140 + caustic * 22;

  // Bright highlights where the caustic peaks — these follow the flow because
  // they're driven by the scrolled noise, not pixel-order rand().
  if (caustic > 0.55) {
    r += 30;
    g += 45;
    b += 40;
  }
  // Dark troughs
  if (caustic < -0.55) {
    r -= 12;
    g -= 18;
    b -= 24;
  }

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

function generateRiver(
  px: number, py: number,
  noise: PerlinNoise,
  _rand: () => number,
  variant: number,
  frame: number,
): [number, number, number] {
  // Directional scroll — rivers flow along a single axis. Small per-frame
  // step (~0.2 units in noise space ≈ 4.4 px on the low-freq term) so the
  // frame-to-frame delta is well within the noise correlation distance and
  // reads as smooth flow rather than discrete snaps.
  const scrollX = frame * 0.2;
  const scrollY = frame * 0.1;
  const vx = variant * 11.9;
  const vy = variant * 5.7;

  // Low-freq streaks flow with the current. High-freq fine detail is NOT
  // scrolled — it stays anchored to the tile, acting as a "static decal"
  // underneath the moving low-freq layer. Without decoupling, the px/7 term
  // shifts nearly a full wavelength per frame and visibly boils.
  const low  = noise.noise2d(px / 22 + vx + scrollX, py / 6 + vy + scrollY);
  const high = noise.noise2d(px / 7  + vx,           py / 4 + vy          ) * 0.5;
  const streak = low + high;

  let r = 36 + streak * 14;
  let g = 86 + streak * 22;
  let b = 148 + streak * 18;

  // Crest highlights — smoothstep ramp instead of hard threshold so the foam
  // fades in continuously rather than popping on/off between frames.
  const bright = smoothstep(0.35, 0.70, streak);
  r += 40 * bright;
  g += 52 * bright;
  b += 48 * bright;

  // Dark troughs — reversed edges so the ramp fires as streak drops below
  // -0.35 and reaches full strength at -0.60.
  const dark = smoothstep(-0.35, -0.60, streak);
  r -= 10 * dark;
  g -= 14 * dark;
  b -= 20 * dark;

  const tint = variantTint(variant);
  return [r + tint[0], g + tint[1], b + tint[2]];
}

const GENERATORS: readonly GeneratorFn[] = [
  generateGrass,
  generateDirt,
  generateRock,
  generateSand,
  generateWater,
  generateRiver,
];

// ---------------------------------------------------------------------------
// Tile and tile-grid generation
// ---------------------------------------------------------------------------

function generateSingleTile(
  terrainType: number,
  variantIndex: number,
  frameIndex: number,
): OffscreenCanvas {
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  const imageData = ctx.createImageData(TILE_W, TILE_H);
  const data = imageData.data;

  const noise = getNoise(terrainType, variantIndex);
  const generator = GENERATORS[terrainType];

  // Re-seeded per frame so static features (tufts, pebbles) on non-animated
  // terrains hit the same pixel positions each regen — frame=0 always for
  // them, so reseeding is a no-op in practice.
  const seed = (terrainType * TERRAIN_COUNT + variantIndex) * 2654435761
    + 374761393
    + frameIndex * 999331;
  const rand = lcg(seed);

  // Fill the ENTIRE rectangle — don't clip to the diamond shape here. The
  // quad renderer's triangles already clip the drawable area to the diamond
  // geometrically, so pixels outside the diamond are never rasterized. But
  // UV interpolation on elevation-deformed triangles can land fragment sample
  // points up to ~1 pixel past the pixel-quantized diamond edge, and if those
  // fallback pixels are transparent, the base fragment shader's `discard`
  // triggers and the clear colour shows through as a dark diamond outline.
  // Filling the rect acts as safety padding for those off-by-one samples.
  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      let [r, g, b] = generator(px, py, noise, rand, variantIndex, frameIndex);

      // Debug overlay: dark band hugging the inside of the diamond edge.
      // Gated to dist <= 1.0 so we ONLY darken in-diamond pixels — the bleed
      // pixels at dist > 1.0 stay untouched as fallback samples for the
      // elevation-deformed-triangle UV-interpolation edge case.
      if (SHOW_TILE_OUTLINES) {
        const dist = diamondEdgeDist(px, py);
        if (dist > 0.94 && dist <= 1.0) {
          r -= 30;
          g -= 30;
          b -= 30;
        }
      }

      const i = (py * TILE_W + px) * 4;
      data[i]     = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return oc;
}

/**
 * Generate raw (unsplit) terrain tile textures. Returns
 * [terrainType][frameIndex][variant] = OffscreenCanvas.
 *
 * Non-animated terrain types have 1 frame (frameIndex always 0).
 * Water (4) and River (5) have WATER_ANIM_FRAMES frames, each produced by
 * scrolling the Perlin sample coordinates — see generateWater/generateRiver.
 */
export function generateRawTerrainTiles(): OffscreenCanvas[][][] {
  const allTiles: OffscreenCanvas[][][] = [];

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const variantCount = TERRAIN_VARIANT_COUNTS[t];
    const isAnimated = t === 4 || t === 5;
    const frameCount = isAnimated ? WATER_ANIM_FRAMES : 1;

    const frames: OffscreenCanvas[][] = [];
    for (let f = 0; f < frameCount; f++) {
      const variants: OffscreenCanvas[] = [];
      for (let v = 0; v < variantCount; v++) {
        variants.push(generateSingleTile(t, v, f));
      }
      frames.push(variants);
    }
    allTiles.push(frames);
  }

  return allTiles;
}

/**
 * Deterministic variant selection per tile coordinate.
 *
 * Uses a multiplicative-XOR hash (MurmurHash3 finalizer style). The previous
 * `(tx*7 + ty*13) % count` formula collapsed to `(tx + ty) % count` whenever
 * 7 and 13 were both ≡ 1 (mod count), which is the case for count ∈ {3, 6}.
 * That made every iso screen row pick a single variant — `screenY = (tx+ty)
 * * HALF_H`, so tiles on the same horizontal row all sit at the same
 * `tx+ty`, and the linear hash gave them all the same value. Visible result:
 * grass and water/river painted the world in horizontal stripes of one
 * variant each, while dirt/rock/sand (count=4) escaped by accident.
 *
 * The bit-mixing here scrambles tile coords enough that the result stays
 * pseudorandom regardless of `count`, so adding new variant counts in the
 * future won't reintroduce the same trap.
 */
export function tileVariant(tileX: number, tileY: number, count: number): number {
  let h = Math.imul(tileX | 0, 0x27d4eb2d);
  h ^= Math.imul(tileY | 0, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % count;
}
