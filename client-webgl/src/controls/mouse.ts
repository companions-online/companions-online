// Mouse input — converts canvas clicks into world tile coordinates and sends
// a MoveTo action to the server. The server runs pathfinding and streams back
// position updates that the scene applies via onEntityUpdate.
//
// Phase 5 stub: every click produces a MoveTo. Phase 8 replaces this with the
// shared action-resolver (click-on-tree → Harvest, click-on-door → Interact,
// etc) plus a local turn-prediction so the player faces the target tile
// immediately.

import { ClientAction } from '@shared/actions.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';

export function attachMouseControls(
  canvas: HTMLCanvasElement,
  scene: Scene,
  connection: Connection,
): void {
  canvas.addEventListener('mousedown', (ev) => {
    // getBoundingClientRect handles any CSS scaling between the canvas
    // element's rendered size and its native pixel size.
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    const tile = scene.camera.tileAt(cx, cy);
    if (!tile) return;

    // Need an entity id before we can issue actions on the player's behalf.
    if (scene.myEntityId === null) return;

    connection.send({ action: ClientAction.MoveTo, tileX: tile.tx, tileY: tile.ty });
  });
}
