// Stubs for the render-time static assets (terrain texture array, mask
// texture array, wall face textures). Tests never actually sample these —
// the mock GL makes draw calls no-ops — but the scene needs a shaped
// layerIndex for the terrain instance builder to consume.

import { TERRAIN_COUNT, TERRAIN_VARIANT_COUNTS, WATER_ANIM_FRAMES } from '@client-webgl/platform/config.js';
import type { StaticAssets } from '@client-webgl/scene.js';
import type { TerrainLayerIndex } from '@client-webgl/terrain/texture-arrays.js';
import type { WallShape } from '@client-webgl/buildings/wall-texture.js';

let handle = 2000;
function fakeTex(): WebGLTexture {
  return (handle++) as unknown as WebGLTexture;
}

/** Build a layerIndex of the same shape production generates — one entry
 *  per (terrain, frame, variant) triple — with every slot pointing to
 *  layer 0. Enough for terrain-instances to look up without going OOB. */
function makeLayerIndex(): TerrainLayerIndex {
  const idx: TerrainLayerIndex = [];
  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const variants = TERRAIN_VARIANT_COUNTS[t];
    // Non-animated terrains have 1 frame; water (4) and river (5) have
    // WATER_ANIM_FRAMES. Mirror that here so instance building doesn't
    // hit an undefined frame slot for animated terrains.
    const frameCount = (t === 4 || t === 5) ? WATER_ANIM_FRAMES : 1;
    const byFrame: number[][] = [];
    for (let f = 0; f < frameCount; f++) {
      const byVariant: number[] = [];
      for (let v = 0; v < variants; v++) byVariant.push(0);
      byFrame.push(byVariant);
    }
    idx.push(byFrame);
  }
  return idx;
}

export function createFakeStaticAssets(): StaticAssets {
  const wallTextures = new Map<WallShape, WebGLTexture>();
  for (let i = 0; i < 4; i++) wallTextures.set(i as WallShape, fakeTex());

  return {
    terrainTexture: {
      texture: fakeTex(),
      layerCount: 64,
      layerIndex: makeLayerIndex(),
    },
    maskTexture: {
      texture: fakeTex(),
      layerCount: 128,
    },
    wallTextures,
  };
}
