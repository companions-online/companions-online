// Sprite registry: loads every PNG declared in sprite-manifest.ts plus the
// unknown-entity fallback at boot, and exposes an O(1) lookup keyed by
// (blueprintId, variant). No lazy loading.
//
// Any blueprint id without a manifest entry resolves to the unknown-entity
// sheet — a static image at /assets/unknown-entity.png — so that network
// arrival of a not-yet-supported blueprint type never crashes the renderer.

import { getBlueprint } from '@shared/blueprints.js';
import { createImageTexture } from '../platform/gl-utils.js';
import { SPRITE_MANIFEST, type SpriteManifestEntry, type SpriteAlign } from './sprite-manifest.js';

export interface SpriteSheetRef {
  texture: WebGLTexture;
  sheetW: number;
  sheetH: number;
  frameW: number;
  frameH: number;
  footX: number;
  footY: number;
  /** Tile-diamond anchor: `'center'` (default) or `'south'`. */
  align: SpriteAlign;
  /** True only for the unknown-entity fallback sheet. Draw paths that would
   *  index into a creature walk-cycle layout (8 dir rows × N frame cols)
   *  must special-case this to a single-frame blit instead. */
  isFallback?: true;
}

export interface SpriteRegistry {
  resolve(blueprintId: number, variant: number): SpriteSheetRef;
}

function pathFor(entry: SpriteManifestEntry, variantCount: number, variant: number): string {
  return variantCount === 1
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

async function loadManifestEntry(
  gl: WebGL2RenderingContext,
  entry: SpriteManifestEntry,
): Promise<SpriteSheetRef[]> {
  const variantCount = getBlueprint(entry.blueprintId)?.variantCount ?? 1;
  return Promise.all(
    Array.from({ length: variantCount }, async (_, v) => {
      const img = await loadImage(pathFor(entry, variantCount, v));
      const foot = entry.detectFoot
        ? detectFootFromImage(img)
        : { footX: entry.footX, footY: entry.footY };
      // For static single-image entries, foot coords from detectFoot are in
      // image-pixel space. Scale to frame-pixel space when the render frame
      // differs from the source PNG (e.g. 32×32 frame from a 64×64 PNG).
      // Animation sheets (layout 'sheet') have manual foot values already in
      // frame space — no scaling.
      const isStatic = (entry.layout ?? 'sheet') === 'static';
      const scaleX = isStatic ? entry.frameW / img.naturalWidth : 1;
      const scaleY = isStatic ? entry.frameH / img.naturalHeight : 1;
      return {
        texture: createImageTexture(gl, img),
        sheetW: img.naturalWidth,
        sheetH: img.naturalHeight,
        frameW: entry.frameW,
        frameH: entry.frameH,
        footX: Math.round(foot.footX * scaleX),
        footY: Math.round(foot.footY * scaleY),
        align: entry.align ?? 'center',
      };
    }),
  );
}

async function loadUnknownSheet(gl: WebGL2RenderingContext): Promise<SpriteSheetRef> {
  const img = await loadImage('/assets/unknown-entity.png');
  // Single-frame sheet: the whole image is one frame, anchored at bottom
  // center. Renderers that index into it (col/row for creature walk cycles)
  // will clamp to this single frame via GL texture clamping.
  return {
    texture: createImageTexture(gl, img),
    sheetW: img.naturalWidth,
    sheetH: img.naturalHeight,
    frameW: img.naturalWidth,
    frameH: img.naturalHeight,
    footX: Math.round(img.naturalWidth / 2),
    footY: img.naturalHeight,
    align: 'center',
    isFallback: true,
  };
}

export async function loadSpriteRegistry(gl: WebGL2RenderingContext): Promise<SpriteRegistry> {
  const sheets = new Map<number, SpriteSheetRef[]>();

  const [_, unknown] = await Promise.all([
    Promise.all(SPRITE_MANIFEST.map(async (entry) => {
      sheets.set(entry.blueprintId, await loadManifestEntry(gl, entry));
    })),
    loadUnknownSheet(gl),
  ]);

  return {
    resolve(blueprintId, variant) {
      const variants = sheets.get(blueprintId);
      if (!variants) return unknown;
      return variants[variant] ?? variants[0];
    },
  };
}
