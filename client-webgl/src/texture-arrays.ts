import { TILE_W, TILE_H } from './config.js';
import { MASKS_PER_MODE, type BlendMaskSet } from './blend-masks.js';
import { createTextureArray, uploadBitmapLayer } from './gl-utils.js';

/**
 * Flat layer lookup for the terrain texture array.
 *
 * The raw tile grid from `generateRawTerrainTiles` is ragged: non-animated
 * terrains have 1 frame, water/river have WATER_ANIM_FRAMES frames. We walk
 * the actual shape and assign sequential layer indices as we go, storing them
 * in a nested array so the renderer can look up `(terrain, frame, variant) →
 * layer` without arithmetic.
 */
export type TerrainLayerIndex = number[][][];

export interface TerrainTextureArray {
  texture: WebGLTexture;
  layerCount: number;
  layerIndex: TerrainLayerIndex;
}

export interface MaskTextureArray {
  texture: WebGLTexture;
  layerCount: number;
}

/** Compute the layer index for a (mode, maskId) pair in the mask texture array. */
export function maskLayerIndex(mode: number, maskId: number): number {
  return mode * MASKS_PER_MODE + maskId;
}

/**
 * Build the terrain texture array from the pre-generated tiles. Flattens the
 * [terrain][frame][variant] grid into sequential layers and uploads each via
 * an ImageBitmap wrapper to dodge browser differences in whether OffscreenCanvas
 * is accepted directly as a `texSubImage3D` source.
 */
export async function buildTerrainTextureArray(
  gl: WebGL2RenderingContext,
  rawTiles: OffscreenCanvas[][][],
): Promise<TerrainTextureArray> {
  const layerIndex: TerrainLayerIndex = [];
  const sources: OffscreenCanvas[] = [];

  for (let t = 0; t < rawTiles.length; t++) {
    const frames = rawTiles[t];
    const byFrame: number[][] = [];
    for (let f = 0; f < frames.length; f++) {
      const variants = frames[f];
      const byVariant: number[] = [];
      for (let v = 0; v < variants.length; v++) {
        byVariant.push(sources.length);
        sources.push(variants[v]);
      }
      byFrame.push(byVariant);
    }
    layerIndex.push(byFrame);
  }

  const texture = createTextureArray(gl, TILE_W, TILE_H, sources.length);

  // Terrain tile canvases store row 0 = top of diamond (N vertex). With the
  // flip set, texture v=0 ends up at image row 0, matching our CORNER_UV
  // lookup (N = (0.5, 0.0)).
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  const bitmaps = await Promise.all(sources.map((c) => createImageBitmap(c)));
  for (let i = 0; i < bitmaps.length; i++) {
    uploadBitmapLayer(gl, texture, i, TILE_W, TILE_H, bitmaps[i]);
    bitmaps[i].close();
  }

  // Restore default pack state.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  return { texture, layerCount: sources.length, layerIndex };
}

/**
 * Build the mask texture array. Layout is a simple `mode * 31 + maskId`
 * mapping (see `maskLayerIndex`), 3 modes × 31 masks = 93 layers.
 */
export async function buildMaskTextureArray(
  gl: WebGL2RenderingContext,
  masks: BlendMaskSet,
): Promise<MaskTextureArray> {
  const sources: OffscreenCanvas[] = [];
  for (let m = 0; m < masks.length; m++) {
    for (let k = 0; k < masks[m].length; k++) {
      sources.push(masks[m][k]);
    }
  }

  const texture = createTextureArray(gl, TILE_W, TILE_H, sources.length);

  // Masks also store row 0 at top (N corner). RGB is meaningless — only α is
  // sampled. PREMULTIPLY=false is safe either way since we don't read .rgb.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  const bitmaps = await Promise.all(sources.map((c) => createImageBitmap(c)));
  for (let i = 0; i < bitmaps.length; i++) {
    uploadBitmapLayer(gl, texture, i, TILE_W, TILE_H, bitmaps[i]);
    bitmaps[i].close();
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  return { texture, layerCount: sources.length };
}
