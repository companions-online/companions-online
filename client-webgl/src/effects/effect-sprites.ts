// Effect sprite loader. Unlike sprite-registry (blueprint-keyed entity
// sheets), these are one-off visual overlays — smoke puffs, attack swings,
// harvest/craft bursts — referenced by name from the animation layer.
//
// Also provides a solid-color 1×1 texture helper used by the HP bar overlay:
// blitting a 1×1 texture to a stretched rectangle yields a filled rect via
// the existing sprite renderer.

import { createImageTexture } from '../platform/gl-utils.js';

export interface EffectSheet {
  texture: WebGLTexture;
  sheetW: number;
  sheetH: number;
  /** Per-frame slice in source-pixel space. */
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  frameCount: number;
}

export interface EffectSprites {
  smoke: EffectSheet;        // 3×3, 9 frames
  attack: EffectSheet;       // 3×3, 6 frames
  harvestCraft: EffectSheet; // 3×3, 7 frames
  healing: EffectSheet;      // 3×3, 9 frames
  /** 1×1 solid-color textures for simple filled-rect overlays (HP bar). */
  hpBarBg: WebGLTexture;
  hpBarFg: WebGLTexture;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

async function loadSheet(
  gl: WebGL2RenderingContext,
  src: string,
  cols: number,
  rows: number,
  frameCount: number,
): Promise<EffectSheet> {
  const img = await loadImage(src);
  return {
    texture: createImageTexture(gl, img),
    sheetW: img.naturalWidth,
    sheetH: img.naturalHeight,
    frameW: img.naturalWidth / cols,
    frameH: img.naturalHeight / rows,
    cols,
    rows,
    frameCount,
  };
}

/** Create a 1×1 RGBA texture filled with the given color (0–255 channels).
 *  Stretched via drawSprite to produce solid-color rectangles. */
export function createSolidColorTexture(
  gl: WebGL2RenderingContext,
  r: number, g: number, b: number, a: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('gl.createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const pixel = new Uint8Array([r, g, b, a]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export async function loadEffectSprites(gl: WebGL2RenderingContext): Promise<EffectSprites> {
  const [smoke, attack, harvestCraft, healing] = await Promise.all([
    loadSheet(gl, '/assets/effects/smoke-anim.png',         3, 3, 9),
    loadSheet(gl, '/assets/effects/attack-anim.png',        3, 3, 6),
    loadSheet(gl, '/assets/effects/harvest-craft-anim.png', 3, 3, 7),
    loadSheet(gl, '/assets/effects/healing-anim.png',       3, 3, 9),
  ]);
  return {
    smoke, attack, harvestCraft, healing,
    // #e63946 bright red, #4a0e0e dark red
    hpBarFg: createSolidColorTexture(gl, 0xe6, 0x39, 0x46, 0xff),
    hpBarBg: createSolidColorTexture(gl, 0x4a, 0x0e, 0x0e, 0xff),
  };
}
