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

/** Animation playback metadata stored on a loaded sheet. `frameMs` is the
 *  per-frame interval (= 1000 / fps), pre-computed so the tick loop doesn't
 *  divide every frame. */
export interface SpriteAnimationRef {
  cols: number;
  rows: number;
  frameCount: number;
  frameMs: number;
}

export interface SpriteSheetRef {
  texture: WebGLTexture;
  sheetW: number;
  sheetH: number;
  /** Source-pixel slice size — the size of one frame in sheet/UV space.
   *  Stays untouched by `scale`; used by all UV math (col/row indexing). */
  frameW: number;
  frameH: number;
  /** Render-pixel destination quad size (= frameW * scale). Used for the
   *  draw destination rectangle and the hit-test AABB. */
  renderW: number;
  renderH: number;
  /** Foot anchor in render-pixel space (already multiplied by scale). */
  footX: number;
  footY: number;
  /** Tile-diamond anchor: `'center'` (default) or `'south'`. */
  align: SpriteAlign;
  /** Present when this sheet is an animation. */
  animation?: SpriteAnimationRef;
  /** Per-pixel alpha (sheet-pixel space, sheetW × sheetH, row-major). One
   *  byte per pixel: > 0 means opaque enough to register a sprite-first
   *  click; 0 means transparent and the click passes through to the next
   *  entity behind. */
  alphaMask: Uint8Array;
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

/** Pull every pixel out of `img` once: returns the full RGBA buffer and an
 *  alpha-only Uint8Array (one byte per pixel) for hit-test sampling. The
 *  RGBA buffer feeds optional foot detection in the same pass — no second
 *  canvas read. */
function readImagePixels(img: HTMLImageElement): {
  rgba: Uint8ClampedArray;
  alpha: Uint8Array;
  width: number;
  height: number;
} {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = rgba[i * 4 + 3];
  }
  return { rgba, alpha, width: w, height: h };
}

/** Scan the RGBA buffer for the bounding box of opaque pixels and return the
 *  horizontal center + one-past-the-bottommost-opaque-row as the foot. */
function detectFootFromPixels(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): { footX: number; footY: number } {
  let minX = w, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 0) {
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
      const pixels = readImagePixels(img);
      const foot = entry.detectFoot
        ? detectFootFromPixels(pixels.rgba, pixels.width, pixels.height)
        : { footX: entry.footX, footY: entry.footY };
      // For static single-image entries, foot coords from detectFoot are in
      // image-pixel space. Scale to frame-pixel space when the render frame
      // differs from the source PNG (e.g. 32×32 frame from a 64×64 PNG).
      // Animation sheets (layout 'sheet') have manual foot values already in
      // frame space — no scaling.
      const isStatic = (entry.layout ?? 'sheet') === 'static';
      const scaleX = isStatic ? entry.frameW / img.naturalWidth : 1;
      const scaleY = isStatic ? entry.frameH / img.naturalHeight : 1;
      const userScale = entry.scale ?? 1;
      return {
        texture: createImageTexture(gl, img),
        sheetW: img.naturalWidth,
        sheetH: img.naturalHeight,
        frameW: entry.frameW,
        frameH: entry.frameH,
        renderW: entry.frameW * userScale,
        renderH: entry.frameH * userScale,
        footX: Math.round(foot.footX * scaleX * userScale),
        footY: Math.round(foot.footY * scaleY * userScale),
        align: entry.align ?? 'center',
        animation: entry.animation
          ? {
              cols: entry.animation.cols,
              rows: entry.animation.rows,
              frameCount: entry.animation.frameCount,
              frameMs: 1000 / entry.animation.fps,
            }
          : undefined,
        alphaMask: pixels.alpha,
      };
    }),
  );
}

async function loadUnknownSheet(gl: WebGL2RenderingContext): Promise<SpriteSheetRef> {
  const img = await loadImage('/assets/unknown-entity.png');
  const pixels = readImagePixels(img);
  // Single-frame sheet: the whole image is one frame, anchored at bottom
  // center. Renderers that index into it (col/row for creature walk cycles)
  // will clamp to this single frame via GL texture clamping.
  return {
    texture: createImageTexture(gl, img),
    sheetW: img.naturalWidth,
    sheetH: img.naturalHeight,
    frameW: img.naturalWidth,
    frameH: img.naturalHeight,
    renderW: img.naturalWidth,
    renderH: img.naturalHeight,
    footX: Math.round(img.naturalWidth / 2),
    footY: img.naturalHeight,
    align: 'center',
    alphaMask: pixels.alpha,
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
