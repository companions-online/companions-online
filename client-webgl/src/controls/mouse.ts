// Mouse input — converts canvas clicks into an ActionContext, lets the
// shared resolveAction decide what to send (move/harvest/attack/interact/
// pickup), and ships the action to the server.
//
// Sprite-first hit testing: before falling back to tile-based resolution,
// the click is tested against each entity's screen-space AABB (populated
// during draw). Clicking anywhere on a deer's sprite resolves to "attack
// deer", even tiles above its actual position.
//
// Local turn prediction: on a MoveTo the player entity's direction is
// updated to face the target tile immediately, so the sprite faces the
// click without waiting for the server checkpoint. The first delta from
// the server overwrites `direction` and corrects it.

import { ClientAction } from '@shared/actions.js';
import { DX, DY, Direction } from '@shared/direction.js';
import { resolveAction } from '@shared/action-resolver.js';
import type { DecodedAction, DecodedActionMoveTo } from '@shared/protocol/codec.js';
import { GAME_ZOOM } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { ClientEntity } from '../entities/client-entity.js';
import type { Connection } from '../network/connection.js';
import { buildCursorContext, buildContextFromEntity } from './cursor-context.js';

function directionFromDelta(dx: number, dy: number): Direction | undefined {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return undefined;
  for (let d = 0; d < 8; d++) {
    if (DX[d] === sx && DY[d] === sy) return d as Direction;
  }
  return undefined;
}

function applyTurnPrediction(scene: Scene, action: DecodedAction): void {
  if (action.action !== ClientAction.MoveTo) return;
  if (scene.myEntityId === null) return;
  const me = scene.entities.get(scene.myEntityId);
  if (!me?.position) return;
  const mv = action as DecodedActionMoveTo;
  const dir = directionFromDelta(
    mv.tileX - me.position.tileX,
    mv.tileY - me.position.tileY,
  );
  if (dir !== undefined) me.direction = { dir };
}

/**
 * Test a virtual-pixel position against all entity AABBs.
 * Returns the frontmost (highest screenY) hit, or null.
 */
export function hitTestEntities(
  scene: Scene,
  virtualX: number,
  virtualY: number,
): ClientEntity | null {
  let best: ClientEntity | null = null;
  for (const [eid, e] of scene.entities) {
    if (eid === scene.myEntityId) continue;
    if (!e.blueprint) continue;
    if (e.screenW === 0) continue; // not yet drawn
    if (virtualX >= e.screenX && virtualX < e.screenX + e.screenW &&
        virtualY >= e.screenY && virtualY < e.screenY + e.screenH) {
      if (!best || e.screenY > best.screenY) {
        best = e;
      }
    }
  }
  return best;
}

export function attachMouseControls(
  canvas: HTMLCanvasElement,
  scene: Scene,
  connection: Connection,
): void {
  canvas.addEventListener('mousedown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    if (scene.myEntityId === null) return;

    // Sprite-first: check AABB hit in virtual-pixel space.
    const vx = cx / GAME_ZOOM;
    const vy = cy / GAME_ZOOM;
    const hit = hitTestEntities(scene, vx, vy);
    if (hit && hit.blueprint) {
      const isGroundItem = !hit.statusEffects;
      const ctx = buildContextFromEntity(scene, {
        entityId: hit.id,
        blueprintId: hit.blueprint.blueprintId,
        isGroundItem,
      });
      if (ctx) {
        const action = resolveAction(ctx);
        if (action) {
          applyTurnPrediction(scene, action);
          connection.send(action);
          return;
        }
      }
    }

    // Fallback: tile-based resolution.
    const tile = scene.camera.tileAt(cx, cy);
    if (!tile) return;

    const ctx = buildCursorContext(scene, tile.tx, tile.ty);
    if (!ctx) return;
    const action = resolveAction(ctx);
    if (!action) return;

    applyTurnPrediction(scene, action);
    connection.send(action);
  });
}
