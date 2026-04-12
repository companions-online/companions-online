import { TILE_W, TILE_H } from '../platform/config.js';
import { createCanvasTexture } from '../platform/gl-utils.js';
import { PerlinNoise } from '@shared/world/noise.js';

const HALF_W = TILE_W / 2; // 32
const HALF_H = TILE_H / 2; // 16

/** Height of the wall face below the top diamond, in pixels. */
export const WALL_HEIGHT = 24;

/** Full wall sprite dimensions. */
export const WALL_SPRITE_W = TILE_W;             // 64
export const WALL_SPRITE_H = TILE_H + WALL_HEIGHT; // 56

/**
 * Auto-tile shape determined by which iso-adjacent neighbours are also walls.
 *
 * "Left face" = SW-edge face (screen-left).
 * "Right face" = SE-edge face (screen-right).
 * These are the two faces visible in the standard iso camera orientation.
 */
export const enum WallShape {
  BothFaces = 0,  // corner / end — both faces visible
  LeftOnly  = 1,  // SE neighbour is wall → right face hidden
  RightOnly = 2,  // SW neighbour is wall → left face hidden
  NoFace    = 3,  // both neighbours are walls → only top diamond
}

// Deterministic pixel-order randomness (same LCG as texture.ts).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Diamond interior test for the top face (same as texture.ts).
function isInsideDiamond(px: number, py: number): boolean {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H <= 1.0;
}

/**
 * Test whether pixel (px, py) in sprite-local coords falls inside the left
 * (SW-edge) wall face parallelogram.
 *
 * Top edge: W corner (0, HALF_H) to S corner (HALF_W, TILE_H), slope = +0.5
 * Bottom edge: same line shifted down by WALL_HEIGHT.
 */
function inLeftFace(px: number, py: number): boolean {
  if (px < 0 || px >= HALF_W) return false;
  const topY = HALF_H + px * 0.5;
  const botY = topY + WALL_HEIGHT;
  return py >= topY && py < botY;
}

/**
 * Test whether pixel (px, py) falls inside the right (SE-edge) wall face.
 *
 * Top edge: S corner (HALF_W, TILE_H) to E corner (TILE_W, HALF_H), slope = -0.5
 * Bottom edge: same line shifted down by WALL_HEIGHT.
 */
function inRightFace(px: number, py: number): boolean {
  if (px < HALF_W || px >= TILE_W) return false;
  const topY = TILE_H - (px - HALF_W) * 0.5;
  const botY = topY + WALL_HEIGHT;
  return py >= topY && py < botY;
}

/**
 * Generate a single wall sprite for the given auto-tile shape.
 *
 * The sprite canvas is WALL_SPRITE_W x WALL_SPRITE_H (64 x 56).
 * - Top face occupies rows 0..TILE_H-1 (diamond-clipped).
 * - Left/right faces hang below the diamond from HALF_H down.
 */
export function generateWallSprite(shape: WallShape): OffscreenCanvas {
  const oc = new OffscreenCanvas(WALL_SPRITE_W, WALL_SPRITE_H);
  const ctx = oc.getContext('2d')!;
  const img = ctx.createImageData(WALL_SPRITE_W, WALL_SPRITE_H);
  const data = img.data;

  const noise = new PerlinNoise(shape * 2654435761 + 0x9e3779b9);
  const rand = lcg(shape * 374761393 + 999331);

  const showLeft = shape === WallShape.BothFaces || shape === WallShape.LeftOnly;
  const showRight = shape === WallShape.BothFaces || shape === WallShape.RightOnly;

  for (let py = 0; py < WALL_SPRITE_H; py++) {
    for (let px = 0; px < WALL_SPRITE_W; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      // Top face — diamond in the top TILE_H rows
      if (py < TILE_H && isInsideDiamond(px, py)) {
        const n = noise.noise2d(px / 8, py / 6);
        const grain = rand() - 0.5;
        r = clamp(130 + n * 14 + grain * 4);
        g = clamp(120 + n * 10 + grain * 3);
        b = clamp(108 + n * 8  + grain * 3);
        a = 255;
      }
      // Left face (SW edge)
      else if (showLeft && inLeftFace(px, py)) {
        // Distance from top edge for stone-block row lines
        const topY = HALF_H + px * 0.5;
        const fy = py - topY; // 0..WALL_HEIGHT within face
        const blockRow = Math.floor(fy / 6);
        const blockCol = Math.floor(px / 8);
        const isMortar = (fy % 6) === 0 || (px % 8) === 0;

        const n = noise.noise2d(px / 6 + 100, py / 5);
        const grain = rand() - 0.5;

        // Darker shade (shadow side)
        r = clamp(95 + n * 10 + grain * 3);
        g = clamp(88 + n * 8  + grain * 3);
        b = clamp(78 + n * 6  + grain * 2);

        if (isMortar) {
          r -= 20; g -= 18; b -= 14;
        }

        // Slight per-block tint
        const bh = Math.imul(blockRow * 0x27d4eb2d, blockCol * 0x165667b1 + 1);
        const bt = ((bh >>> 20) / 4096.0 - 0.5) * 6;
        r = clamp(r + bt);
        g = clamp(g + bt * 0.8);
        b = clamp(b + bt * 0.6);
        a = 255;
      }
      // Right face (SE edge)
      else if (showRight && inRightFace(px, py)) {
        const topY = TILE_H - (px - HALF_W) * 0.5;
        const fy = py - topY;
        const blockRow = Math.floor(fy / 6);
        const blockCol = Math.floor((px - HALF_W) / 8);
        const isMortar = (fy % 6) === 0 || ((px - HALF_W) % 8) === 0;

        const n = noise.noise2d(px / 6 + 200, py / 5);
        const grain = rand() - 0.5;

        // Lighter shade (lit side)
        r = clamp(120 + n * 12 + grain * 3);
        g = clamp(112 + n * 10 + grain * 3);
        b = clamp(100 + n * 8  + grain * 2);

        if (isMortar) {
          r -= 22; g -= 20; b -= 16;
        }

        const bh = Math.imul(blockRow * 0x27d4eb2d, blockCol * 0x165667b1 + 1);
        const bt = ((bh >>> 20) / 4096.0 - 0.5) * 6;
        r = clamp(r + bt);
        g = clamp(g + bt * 0.8);
        b = clamp(b + bt * 0.6);
        a = 255;
      }

      const i = (py * WALL_SPRITE_W + px) * 4;
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }

  ctx.putImageData(img, 0, 0);
  return oc;
}

/**
 * Generate all 4 wall shape textures and upload to GL as 2D textures.
 */
export function generateWallTextures(gl: WebGL2RenderingContext): Map<WallShape, WebGLTexture> {
  const textures = new Map<WallShape, WebGLTexture>();
  const shapes = [WallShape.BothFaces, WallShape.LeftOnly, WallShape.RightOnly, WallShape.NoFace];
  for (const shape of shapes) {
    const canvas = generateWallSprite(shape);
    textures.set(shape, createCanvasTexture(gl, canvas));
  }
  return textures;
}
