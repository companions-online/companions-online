// Sprite registry: loads every PNG declared in sprite-manifest.ts at boot and
// exposes an O(1) lookup keyed by (blueprintId, variant). No lazy loading,
// no per-blueprint resolver functions, no within-sheet variant packing.

import { createImageTexture } from '../platform/gl-utils.js';
import { SPRITE_MANIFEST, type SpriteManifestEntry } from './sprite-manifest.js';

export interface SpriteSheetRef {
  texture: WebGLTexture;
  sheetW: number;
  sheetH: number;
  frameW: number;
  frameH: number;
  footX: number;
  footY: number;
}

export interface SpriteRegistry {
  resolve(blueprintId: number, variant: number): SpriteSheetRef;
}

function pathFor(entry: SpriteManifestEntry, variant: number): string {
  return entry.variantCount === 1
    ? `/assets/${entry.name}.png`
    : `/assets/${entry.name}-${variant}.png`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadSpriteRegistry(gl: WebGL2RenderingContext): Promise<SpriteRegistry> {
  const sheets = new Map<number, SpriteSheetRef[]>();

  await Promise.all(SPRITE_MANIFEST.map(async (entry) => {
    const refs: SpriteSheetRef[] = await Promise.all(
      Array.from({ length: entry.variantCount }, async (_, v) => {
        const img = await loadImage(pathFor(entry, v));
        return {
          texture: createImageTexture(gl, img),
          sheetW: img.naturalWidth,
          sheetH: img.naturalHeight,
          frameW: entry.frameW,
          frameH: entry.frameH,
          footX: entry.footX,
          footY: entry.footY,
        };
      }),
    );
    sheets.set(entry.blueprintId, refs);
  }));

  return {
    resolve(blueprintId, variant) {
      const variants = sheets.get(blueprintId);
      if (!variants) throw new Error(`no sprites registered for blueprint ${blueprintId}`);
      // Fall back to variant 0 if a server tells us about an unknown variant.
      return variants[variant] ?? variants[0];
    },
  };
}
