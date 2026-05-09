// One-shot loader for the menu logo (assets/ui/game-logo.png).
// Mirrors the effect-sprites Image-element pattern; not registered in the
// sprite-registry manifest because the menu is its only consumer.

import { createImageTexture } from '../platform/gl-utils.js';

export interface MenuLogo {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export async function loadMenuLogo(gl: WebGL2RenderingContext): Promise<MenuLogo> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('failed to load /assets/ui/game-logo.png'));
    img.src = '/assets/ui/game-logo.png';
  });
  return {
    texture: createImageTexture(gl, img),
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}
