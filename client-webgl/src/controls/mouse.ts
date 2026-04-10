// Mouse input — translates canvas clicks into world tile coordinates and
// dispatches them through scene.playerControls.moveTo. Doesn't know about
// ClientEntity types; the player exposes itself via the playerControls slot
// regardless of what kind of entity it is.

import type { Scene } from '../scene.js';

export function attachMouseControls(canvas: HTMLCanvasElement, scene: Scene): void {
  canvas.addEventListener('mousedown', (ev) => {
    // getBoundingClientRect handles any CSS scaling between the canvas
    // element's rendered size and its native pixel size.
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    const tile = scene.camera.tileAt(cx, cy);
    if (tile && scene.playerControls) {
      scene.playerControls.moveTo(tile.tx, tile.ty);
    }
  });
}
