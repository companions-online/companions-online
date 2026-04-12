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

/** Scan the image for the bounding box of opaque pixels and return the
 *  horizontal center + one-past-the-bottommost-opaque-row as the foot. */
function detectFootFromImage(img: HTMLImageElement): { footX: number; footY: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    footX: Math.round((minX + maxX) / 2),
    footY: maxY + 1,
  };
}

export async function loadSpriteRegistry(gl: WebGL2RenderingContext): Promise<SpriteRegistry> {
  const sheets = new Map<number, SpriteSheetRef[]>();

  await Promise.all(SPRITE_MANIFEST.map(async (entry) => {
    const refs: SpriteSheetRef[] = await Promise.all(
      Array.from({ length: entry.variantCount }, async (_, v) => {
        const img = await loadImage(pathFor(entry, v));
        const foot = entry.detectFoot
          ? detectFootFromImage(img)
          : { footX: entry.footX, footY: entry.footY };
        return {
          texture: createImageTexture(gl, img),
          sheetW: img.naturalWidth,
          sheetH: img.naturalHeight,
          frameW: entry.frameW,
          frameH: entry.frameH,
          footX: foot.footX,
          footY: foot.footY,
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
