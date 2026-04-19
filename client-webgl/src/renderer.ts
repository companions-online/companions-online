import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, TILE_W, TILE_H, PX_PER_Z, GAME_ZOOM } from './platform/config.js';
import { tileToScreen } from '@shared/coordinates.js';
import { resolveAction, describeAction } from '@shared/action-resolver.js';
import { MetaKey } from '@shared/entity-meta.js';
import { buildCursorContext, buildContextFromEntity } from './controls/cursor-context.js';
import { hitTestEntities } from './controls/mouse.js';
import type { Scene } from './scene.js';
import type { KeyboardState } from './controls/keyboard.js';
import type { TextSurface } from './effects/text-surface.js';
import { drawHud } from './ui/hud.js';
import { drawPlacementGhost } from './ui/placement.js';

const NAMEPLATE_FONT_PX = 11;
/** Vertical offset above the entity tile's north vertex. Tuned to sit
 *  clearly above the 92px player sprite (head ~66px above the foot). */
const NAMEPLATE_OFFSET_Y = 60;

/**
 * RAF loop: tick entities, drain dirty chunks, draw terrain + Y-sorted
 * sprites (entities + walls) + effects + HUD. One frame per requestAnimationFrame.
 */
export function createRenderer(canvas: HTMLCanvasElement, scene: Scene, keyboard: KeyboardState) {
  const gl = scene.gl;
  let lastTime = 0;

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  gl.viewport(0, 0, CANVAS_W, CANVAS_H);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.067, 0.067, 0.067, 1.0); // #111

  // Virtual resolution for the game pass — everything renders at GAME_ZOOM×.
  // HUD pass uses native canvas resolution so text stays crisp.
  const gameResolution: [number, number] = [CANVAS_W / GAME_ZOOM, CANVAS_H / GAME_ZOOM];
  const hudResolution: [number, number] = [CANVAS_W, CANVAS_H];

  // Mouse position tracking for debug overlay. `scene.cursorScreenX/Y`
  // is also kept in sync by attachMouseControls — these locals are only
  // for the debug hit-test path below.
  let mouseCanvasX = 0;
  let mouseCanvasY = 0;
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    mouseCanvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    mouseCanvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
  });

  let lastCursorStyle: string | null = null;
  function syncCursorStyle() {
    const want = scene.heldStack ? 'none' : '';
    if (want !== lastCursorStyle) {
      canvas.style.cursor = want;
      lastCursorStyle = want;
    }
  }

  function frame(now: number) {
    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    scene.time = now;

    // Rebuild chunks that were dirtied by chunk arrival / tile deltas /
    // eviction since last frame. Runs before draw so the GPU sees a
    // consistent snapshot.
    scene.processDirtyChunks();

    for (const e of scene.entities.values()) {
      e.tick?.(e, dt, scene);
    }

    // Camera follows the player entity once it arrives from the server;
    // otherwise stays at its initial SPAWN position. Pass ground z so the
    // viewport translates up/down with the player's hill height.
    let playerTileX: number | undefined;
    let playerTileY: number | undefined;
    if (scene.myEntityId !== null) {
      const me = scene.entities.get(scene.myEntityId);
      if (me) {
        scene.camera.follow(me.visualX, me.visualY, scene.getGroundZ(me.visualX, me.visualY));
        playerTileX = me.visualX;
        playerTileY = me.visualY;
      }
    }

    // Rebuild the lightmap before any draw that samples it. Uses the
    // player's current tile as the window center; falls back to spawn when
    // the player entity hasn't arrived yet.
    scene.lighting.update(
      playerTileX ?? 0,
      playerTileY ?? 0,
      scene.entities.values(),
      scene.worldMap,
      now,
    );
    const lightmapBinding = {
      texture: scene.lighting.texture,
      originX: scene.lighting.originX,
      originY: scene.lighting.originY,
      size: scene.lighting.size,
    };

    const [offsetX, offsetY] = scene.camera.getOffset();

    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(GAME_X, CANVAS_H - GAME_Y - GAME_H, GAME_W, GAME_H);

    scene.terrainRenderer.render(
      gameResolution,
      [offsetX, offsetY],
      scene.terrainTexture.texture,
      scene.maskTexture.texture,
      scene.time,
      lightmapBinding,
    );

    // Sprite pass — Y-sorted. Entities + walls from every live chunk.
    // Pre-populate screenY with elevation applied so the sort matches what
    // the draw path will render (walls bake elevation into screenY at build
    // time too — keeping both sides consistent is what makes Y-sort work).
    const drawList: { screenY: number; draw: () => void }[] = [];
    for (const e of scene.entities.values()) {
      const scr = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
      const z = scene.getGroundZ(e.visualX, e.visualY);
      e.screenY = scr.screenY - z * PX_PER_Z;
      drawList.push({
        screenY: e.screenY,
        draw: () => e.draw?.(e, scene.spriteRenderer, gl, offsetX, offsetY, scene),
      });
    }
    for (const walls of scene.wallDrawablesByChunk.values()) {
      for (const w of walls) {
        drawList.push({
          screenY: w.screenY,
          draw: () => w.draw(scene.spriteRenderer, gl, offsetX, offsetY),
        });
      }
    }

    if (drawList.length > 0) {
      scene.spriteRenderer.begin(gameResolution, lightmapBinding);
      drawList.sort((a, b) => a.screenY - b.screenY);
      for (const d of drawList) d.draw();
      scene.spriteRenderer.end();
    }

    // Nameplate pass — draw entity-meta `name` above each named entity.
    drawNameplates(gl, scene, offsetX, offsetY, gameResolution);

    // Effects pass (chat bubbles, damage numbers, pickup text).
    scene.effects.tick(scene);
    scene.effects.draw(scene.spriteRenderer, gl, offsetX, offsetY, scene, gameResolution);

    // Placement ghost — drawn unlit in game space, after effects, so the
    // preview always sits on top of terrain / entities / walls.
    if (scene.placementHoverTile) {
      scene.spriteRenderer.begin(gameResolution);
      drawPlacementGhost(gl, scene, scene.spriteRenderer, offsetX, offsetY);
      scene.spriteRenderer.end();
    }

    gl.disable(gl.SCISSOR_TEST);

    // Debug overlay: resolve action under mouse cursor.
    // Sprite-first AABB hit test, then tile-based fallback.
    let debugLabel: string | null = null;
    if (keyboard.debugMode) {
      const vx = mouseCanvasX / GAME_ZOOM;
      const vy = mouseCanvasY / GAME_ZOOM;
      const hit = hitTestEntities(scene, vx, vy);
      if (hit?.blueprint) {
        const ctx = buildContextFromEntity(scene, {
          entityId: hit.id,
          blueprintId: hit.blueprint.blueprintId,
          isGroundItem: !hit.statusEffects,
        });
        if (ctx) {
          const action = resolveAction(ctx);
          debugLabel = describeAction(action, ctx);
        }
      }
      // if (!debugLabel) {
      //   const tile = scene.camera.tileAt(mouseCanvasX, mouseCanvasY);
      //   if (tile) {
      //     const ctx = buildCursorContext(scene, tile.tx, tile.ty);
      //     if (ctx) {
      //       const action = resolveAction(ctx);
      //       debugLabel = describeAction(action, ctx);
      //     }
      //   }
      // }
    }

    drawHud(gl, scene, scene.spriteRenderer, keyboard, hudResolution, debugLabel);
    syncCursorStyle();

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}

function drawNameplates(
  gl: WebGL2RenderingContext,
  scene: Scene,
  offsetX: number,
  offsetY: number,
  resolution: readonly [number, number],
): void {
  if (scene.entityMeta.size === 0) return;

  // Build draw list first so we can skip begin/end when no named entity is visible.
  const items: { surface: TextSurface; dstX: number; dstY: number }[] = [];
  for (const [eid, meta] of scene.entityMeta) {
    if (eid === scene.myEntityId) continue;
    const name = meta.get(MetaKey.Name);
    if (!name) continue;
    const entity = scene.entities.get(eid);
    if (!entity) continue;

    let cached = scene.nameplateCache.get(name);
    if (!cached) {
      cached = scene.textSurfaceFactory.create({
        text: name,
        fillColor: '#fff',
        outlineColor: '#000',
        fontPx: NAMEPLATE_FONT_PX,
        bold: true,
      });
      scene.nameplateCache.set(name, cached);
    }

    const scr = tileToScreen(entity.visualX, entity.visualY, TILE_W, TILE_H);
    const z = scene.getGroundZ(entity.visualX, entity.visualY);
    const dstX = scr.screenX + offsetX + TILE_W / 2 - cached.width / 2;
    const dstY = scr.screenY + offsetY - z * PX_PER_Z - NAMEPLATE_OFFSET_Y - cached.height;
    items.push({ surface: cached, dstX, dstY });
  }

  if (items.length === 0) return;

  scene.spriteRenderer.begin(resolution);
  for (const item of items) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, item.surface.texture);
    scene.spriteRenderer.drawSprite(
      item.dstX, item.dstY, item.surface.width, item.surface.height,
      0, 0, 1, 1,
    );
  }
  scene.spriteRenderer.end();
}
