// Pre-baked 1×1 solid-color textures used by the menu/widget kit.
// Mirrors the HP-bar pattern in effects/effect-sprites.ts: bind a 1×1
// texture, drawSprite stretches it into a filled rectangle. One pre-baked
// color per role keeps the call sites bind-then-draw with no setTint/reset
// dance, and concentrates the menu's color palette in one place.

import { createSolidColorTexture } from '../effects/effect-sprites.js';

export interface WidgetPalette {
  /** Default button / panel background. */
  bg: WebGLTexture;
  /** Button background while the cursor is over it. */
  bgHover: WebGLTexture;
  /** Button background while armed (mouse down on self). */
  bgPressed: WebGLTexture;
  /** Border / divider line color. */
  border: WebGLTexture;
  /** TextInput interior. */
  inputBg: WebGLTexture;
  /** Full-screen dim for backdrop fade. */
  dim: WebGLTexture;
  /** Highlight color — focused input border, selected avatar tile, caret. */
  accent: WebGLTexture;
  /** Secondary text / disabled label color (used as a backdrop quad too). */
  textSecondary: WebGLTexture;
}

export function createWidgetPalette(gl: WebGL2RenderingContext): WidgetPalette {
  return {
    bg:            createSolidColorTexture(gl, 0x2a, 0x2e, 0x36, 0xff),
    bgHover:       createSolidColorTexture(gl, 0x3a, 0x40, 0x4a, 0xff),
    bgPressed:     createSolidColorTexture(gl, 0x1a, 0x1d, 0x22, 0xff),
    border:        createSolidColorTexture(gl, 0x6a, 0x70, 0x7a, 0xff),
    inputBg:       createSolidColorTexture(gl, 0x12, 0x14, 0x18, 0xff),
    dim:           createSolidColorTexture(gl, 0x00, 0x00, 0x00, 0xff),
    accent:        createSolidColorTexture(gl, 0xff, 0xb0, 0x40, 0xff),
    textSecondary: createSolidColorTexture(gl, 0x90, 0x90, 0x98, 0xff),
  };
}
