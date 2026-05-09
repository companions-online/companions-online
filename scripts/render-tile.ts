// Render a single procedural sprite to a 64×64 PNG, bottom-aligned (south
// vertex), matching the sprite-manifest layout used by ground-item / placeable
// inventory icons.
//
// Modes:
//   wooden-floor  → terrain.ts generateWoodenFloor (Terrain=6, variant 0)
//   stone-floor   → terrain.ts generateStoneFloor  (Terrain=7, variant 0)
//   wooden-wall   → wall-texture.ts generateWallSprite(BothFaces)
//
// Output: client-webgl/assets/placeables/<kebab-name>.png — matches the
// asset folder layout (see sprite-manifest.ts).
//
// Run: tsx scripts/render-tile.ts wooden-floor stone-floor wooden-wall

import { createCanvas } from 'canvas';

(globalThis as any).OffscreenCanvas = class OffscreenCanvas {
  constructor(width: number, height: number) {
    return createCanvas(width, height) as any;
  }
};

import fs from 'fs';
import path from 'path';
import { generateRawTerrainTiles } from '../client-webgl/src/terrain/texture.js';
import { generateWallSprite, WallShape, WALL_SPRITE_W, WALL_SPRITE_H } from '../client-webgl/src/buildings/wall-texture.js';
import { TILE_W, TILE_H } from '../client-webgl/src/platform/config.js';

const OUT_DIR = path.resolve(import.meta.dirname!, '../client-webgl/assets/placeables');
const OUT_W = 64;
const OUT_H = 64;

// Terrain enum values for the rendering-only floor types.
const TERRAIN_WOODEN_FLOOR = 6;
const TERRAIN_STONE_FLOOR = 7;

interface TileSpec {
  name: string;
  outputName: string;
  render: () => any; // OffscreenCanvas-shaped (node-canvas) source
  srcW: number;
  srcH: number;
  /** Diamond-clip the source before compositing. True for terrain tiles
   *  (in-engine the quad pipeline clips to the diamond geometrically — for a
   *  static PNG icon we have to do it ourselves). False for the wall sprite
   *  whose silhouette already includes the two hanging faces. */
  diamondClip: boolean;
}

function tileFromTerrain(terrainType: number): { src: any; w: number; h: number } {
  // generateRawTerrainTiles() returns [terrainType][frame][variant] = canvas.
  // Floors are non-animated (1 frame) with 4 variants — pick variant 0.
  const tiles = generateRawTerrainTiles();
  const variants = tiles[terrainType][0];
  return { src: variants[0], w: TILE_W, h: TILE_H };
}

const TILES: Record<string, TileSpec> = {
  'wooden-floor': {
    name: 'wooden-floor',
    outputName: 'wooden-floor.png',
    srcW: TILE_W,
    srcH: TILE_H,
    render: () => tileFromTerrain(TERRAIN_WOODEN_FLOOR).src,
    diamondClip: true,
  },
  'stone-floor': {
    name: 'stone-floor',
    outputName: 'stone-floor.png',
    srcW: TILE_W,
    srcH: TILE_H,
    render: () => tileFromTerrain(TERRAIN_STONE_FLOOR).src,
    diamondClip: true,
  },
  'wooden-wall': {
    name: 'wooden-wall',
    outputName: 'wooden-wall.png',
    srcW: WALL_SPRITE_W,
    srcH: WALL_SPRITE_H,
    render: () => generateWallSprite(WallShape.BothFaces),
    diamondClip: false,
  },
};

function applyDiamondMask(src: any, w: number, h: number): any {
  // Build a fresh canvas containing only the diamond-shaped pixels of `src`;
  // everything outside the iso diamond becomes alpha 0.
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d') as any;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const halfW = w / 2;
  const halfH = h / 2;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = Math.abs(px - halfW + 0.5) / halfW;
      const dy = Math.abs(py - halfH + 0.5) / halfH;
      if (dx + dy > 1.0) {
        data[(py * w + px) * 4 + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function compositeBottomAligned(src: any, srcW: number, srcH: number): Buffer {
  // Place the source sprite into an OUT_W × OUT_H transparent canvas with
  // its bottom edge flush to the canvas bottom, horizontally centered. This
  // yields a south-anchor sprite that detectFoot in sprite-registry.ts will
  // resolve correctly.
  const out = createCanvas(OUT_W, OUT_H);
  const ctx = out.getContext('2d') as any;
  ctx.imageSmoothingEnabled = false;
  const dx = Math.floor((OUT_W - srcW) / 2);
  const dy = OUT_H - srcH;
  ctx.drawImage(src, dx, dy);
  return out.toBuffer('image/png');
}

function renderTile(key: string): void {
  const spec = TILES[key];
  if (!spec) {
    const known = Object.keys(TILES).join(', ');
    console.error(`unknown tile: ${key} (known: ${known})`);
    process.exit(1);
  }
  const raw = spec.render();
  const src = spec.diamondClip ? applyDiamondMask(raw, spec.srcW, spec.srcH) : raw;
  const png = compositeBottomAligned(src, spec.srcW, spec.srcH);
  const outPath = path.join(OUT_DIR, spec.outputName);
  fs.writeFileSync(outPath, png);
  console.log(`${spec.name}: ${spec.srcW}×${spec.srcH} → ${OUT_W}×${OUT_H} → ${outPath}`);
}

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : Object.keys(TILES);
for (const t of targets) renderTile(t);
