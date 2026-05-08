import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, TILE_W, TILE_H, PX_PER_Z, GAME_ZOOM } from './platform/config.js';
import { tileToScreen } from '@shared/coordinates.js';
import { isPlaced } from '@shared/status-effects.js';
import { resolveAction, describeAction } from '@shared/action-resolver.js';
import { MetaKey } from '@shared/entity-meta.js';
import { getBlueprint } from '@shared/blueprints.js';
import { ActionType } from '@shared/actions.js';
import { buildCursorContext, buildContextFromEntity } from './controls/cursor-context.js';
import { hitTestEntities } from './controls/mouse.js';
import type { Scene } from './scene.js';
import type { KeyboardState } from './controls/keyboard.js';
import type { TextSurface } from './effects/text-surface.js';
import { drawHud } from './ui/hud.js';
import { drawPlacementGhost } from './ui/placement.js';

const NAMEPLATE_FONT_PX = 11;
const HP_BAR_W = 24;
const HP_BAR_H = 3;
/** Gap between sprite top and HP bar bottom (and between HP bar top and
 *  nameplate bottom). Keeps stacked overlays from crowding the sprite
 *  regardless of sprite height (player=128, deer=64, etc.). */
const OVERLAY_GAP = 4;

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

    // Tick the autopilot first so the latest observerFocus drives this frame's
    // camera + lighting.
    scene.observerCamera?.tick(now);

    // Camera follows the player entity once it arrives from the server;
    // in observer mode it follows scene.observerFocus instead. Pass ground z
    // so the viewport translates up/down with the focus tile's hill height.
    let playerTileX: number | undefined;
    let playerTileY: number | undefined;
    if (scene.myEntityId !== null) {
      const me = scene.entities.get(scene.myEntityId);
      if (me) {
        scene.camera.follow(me.visualX, me.visualY, scene.getGroundZ(me.visualX, me.visualY));
        playerTileX = me.visualX;
        playerTileY = me.visualY;
      }
    } else if (scene.observerFocus) {
      const { tileX, tileY } = scene.observerFocus;
      scene.camera.follow(tileX, tileY, scene.getGroundZ(tileX, tileY));
      playerTileX = tileX;
      playerTileY = tileY;
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

    // Entity overlays: HP bars + nameplates in a single unlit pass.
    drawEntityOverlays(gl, scene, offsetX, offsetY, gameResolution);

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

    // Cooking highlight: the adjacent campfire is tinted red inside the
    // main sprite pass (see static-entity.ts::drawAnimatedStatic). No
    // separate pass needed.

    gl.disable(gl.SCISSOR_TEST);

    // Action label: resolve action under mouse cursor (always visible,
    // top-left of play area). Sprite-first AABB hit test.
    let actionLabel: string | null = null;
    {
      const vx = mouseCanvasX / GAME_ZOOM;
      const vy = mouseCanvasY / GAME_ZOOM;
      const hit = hitTestEntities(scene, vx, vy);
      if (hit?.blueprint) {
        const ctx = buildContextFromEntity(scene, {
          entityId: hit.id,
          blueprintId: hit.blueprint.blueprintId,
          isGroundItem: !isPlaced(hit.statusEffects),
        });
        if (ctx) {
          const action = resolveAction(ctx);
          actionLabel = describeAction(action, ctx);
        }
      }
    }

    drawHud(gl, scene, scene.spriteRenderer, keyboard, hudResolution, actionLabel);

    // Menu pass — drawn last so it sits on top of the live observer world.
    // The menu controller short-circuits when overlay.kind !== 'menu'.
    if (scene.menu && scene.overlay.kind === 'menu') {
      scene.menu.draw(scene);
    }

    syncCursorStyle();

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}

interface NameplateItem { surface: TextSurface; dstX: number; dstY: number }
interface HpBarItem { dstX: number; dstY: number; ratio: number }

/** Virtual-pixel Y of the top of the entity's sprite quad (same math as
 *  creature-entity.draw: foot_y = screenY + offsetY + TILE_H/2 - z*PX_PER_Z;
 *  top_y = foot_y - footY). Returns NaN when the entity has no sprite sheet. */
function entitySpriteTopY(e: import('./entities/client-entity.js').ClientEntity, offsetY: number, z: number): number {
  const sheet = e.spriteSheet;
  const scr = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  return scr.screenY + offsetY + TILE_H / 2 - sheet.footY - z * PX_PER_Z;
}

function drawEntityOverlays(
  gl: WebGL2RenderingContext,
  scene: Scene,
  offsetX: number,
  offsetY: number,
  resolution: readonly [number, number],
): void {
  const nameplates: NameplateItem[] = [];
  const hpBars: HpBarItem[] = [];

  // HP bars: any creature/NPC (including local player) whose HP < max and
  // isn't Dead. Positioned just above the sprite top so a 128px player and a
  // 32px deer both get bars at the same relative location (over their head).
  for (const [, e] of scene.entities) {
    if (!e.health || e.health.currentHp >= e.health.maxHp) continue;
    if (e.currentAction?.actionType === ActionType.Dead) continue;
    if (!e.blueprint) continue;
    const bp = getBlueprint(e.blueprint.blueprintId);
    if (bp?.category !== 'creature' && bp?.category !== 'npc') continue;

    const scr = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
    const z = scene.getGroundZ(e.visualX, e.visualY);
    const spriteTopY = entitySpriteTopY(e, offsetY, z);
    const dstX = scr.screenX + offsetX + TILE_W / 2 - HP_BAR_W / 2;
    const dstY = spriteTopY - OVERLAY_GAP - HP_BAR_H;
    hpBars.push({ dstX, dstY, ratio: e.health.currentHp / e.health.maxHp });
  }

  // Nameplates: named entities except the local player. Stacks above the HP
  // bar slot (same math regardless of whether a bar is actually drawn — the
  // reserved slot keeps nameplates at a consistent height for an entity).
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
    const spriteTopY = entitySpriteTopY(entity, offsetY, z);
    const dstX = scr.screenX + offsetX + TILE_W / 2 - cached.width / 2;
    const dstY = spriteTopY - OVERLAY_GAP - HP_BAR_H - OVERLAY_GAP - cached.height;
    nameplates.push({ surface: cached, dstX, dstY });
  }

  if (nameplates.length === 0 && hpBars.length === 0) return;

  scene.spriteRenderer.begin(resolution);

  // HP bars first (bg then fg), nameplates on top.
  for (const bar of hpBars) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.effectSprites.hpBarBg);
    scene.spriteRenderer.drawSprite(bar.dstX, bar.dstY, HP_BAR_W, HP_BAR_H, 0, 0, 1, 1);
    gl.bindTexture(gl.TEXTURE_2D, scene.effectSprites.hpBarFg);
    scene.spriteRenderer.drawSprite(bar.dstX, bar.dstY, HP_BAR_W * bar.ratio, HP_BAR_H, 0, 0, 1, 1);
  }

  for (const item of nameplates) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, item.surface.texture);
    scene.spriteRenderer.drawSprite(
      item.dstX, item.dstY, item.surface.width, item.surface.height,
      0, 0, 1, 1,
    );
  }

  scene.spriteRenderer.end();
}
