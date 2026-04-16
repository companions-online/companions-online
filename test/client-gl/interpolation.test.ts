import { describe, it, expect } from 'vitest';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { TICK_RATE } from '@shared/constants.js';
import { ActionType } from '@shared/actions.js';
import { createTestScene } from './harness.js';
import type { ClientEntity } from '@client-webgl/entities/client-entity.js';
import type { Scene } from '@client-webgl/scene.js';
import type { FakeConnection } from './fake-connection.js';

// Cardinal lerp duration matches the server's tick-quantized step time.
// Player speed = 3, TICK_RATE = 20 → ticksPerStep = round(20/3) = 7 → 350ms.
const PLAYER_SPEED = getBlueprint(BlueprintType.Player)!.speed!;
const TICKS_PER_STEP = Math.max(1, Math.round(TICK_RATE / PLAYER_SPEED));
const DURATION_MS = TICKS_PER_STEP * (1000 / TICK_RATE);

function tickEntity(scene: Scene, e: ClientEntity, dt: number): void {
  e.tick?.(e, dt, scene);
}

function spawnPlayer(
  scene: Scene,
  conn: FakeConnection,
  id: number,
  tileX: number,
  tileY: number,
): ClientEntity {
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId: id,
      components: {
        position: { tileX, tileY },
        blueprint: { blueprintId: BlueprintType.Player, variant: 0 },
        currentAction: { actionType: ActionType.Walking },
      },
    },
  });
  return scene.entities.get(id)!;
}

describe('creature-entity interpolation', () => {
  it('starts at position on first arrival (no lerp state set)', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 1000;
    const e = spawnPlayer(scene, conn, 1, 10, 10);
    tickEntity(scene, e, 0);
    expect(e.visualX).toBe(10);
    expect(e.visualY).toBe(10);
  });

  it('lerps linearly from previous tile to newly-received tile', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 1000;
    const e = spawnPlayer(scene, conn, 1, 5, 5);
    tickEntity(scene, e, 0); // settle at (5, 5)

    // Server ticks: position moves to (6, 5). Checkpoint at scene.time=1000.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{ entityId: 1, components: { position: { tileX: 6, tileY: 5 } } }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });

    // 0ms in: still at origin.
    tickEntity(scene, e, 0);
    expect(e.visualX).toBeCloseTo(5, 5);
    expect(e.visualY).toBeCloseTo(5, 5);

    // Halfway through the 333ms traversal.
    scene.time = 1000 + DURATION_MS / 2;
    tickEntity(scene, e, 0);
    expect(e.visualX).toBeCloseTo(5.5, 2);
    expect(e.visualY).toBeCloseTo(5, 5);

    // Past the duration: clamp to target.
    scene.time = 1000 + DURATION_MS * 2;
    tickEntity(scene, e, 0);
    expect(e.visualX).toBeCloseTo(6, 5);
    expect(e.visualY).toBeCloseTo(5, 5);
  });

  it('re-checkpoints when a new position arrives mid-lerp', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 0;
    const e = spawnPlayer(scene, conn, 1, 0, 0);

    // First leg: 0→1 tile.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{ entityId: 1, components: { position: { tileX: 1, tileY: 0 } } }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });

    // Advance halfway — entity at ~0.5.
    scene.time = DURATION_MS / 2;
    tickEntity(scene, e, 0);
    expect(e.visualX).toBeCloseTo(0.5, 2);

    // Second update arrives mid-traversal: new position is 2. lerpFrom
    // should snapshot the current visual (~0.5), not the previous tile (0).
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 2,
        entityUpdates: [{ entityId: 1, components: { position: { tileX: 2, tileY: 0 } } }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    // Checkpoint was set at scene.time = DURATION_MS / 2. lerpFrom = ~0.5.
    // Advance another half-duration — should be halfway between 0.5 and 2 = 1.25.
    scene.time = DURATION_MS;
    tickEntity(scene, e, 0);
    expect(e.visualX).toBeCloseTo(1.25, 2);
  });

  it('stationary entity (no position update) does not advance', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 0;
    const e = spawnPlayer(scene, conn, 1, 3, 3);
    tickEntity(scene, e, 0);
    const x0 = e.visualX;

    scene.time = 5000;
    tickEntity(scene, e, 0);
    // No position change = no lerpFrom set; default target == current position.
    expect(e.visualX).toBe(x0);
    expect(e.visualY).toBe(3);
  });

  it('position update to the same tile does not reset the lerp', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 0;
    const e = spawnPlayer(scene, conn, 1, 5, 5);
    tickEntity(scene, e, 0);

    // Repeated identical-position update should not re-checkpoint.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{ entityId: 1, components: { position: { tileX: 5, tileY: 5 } } }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    expect(e.lerpFromX).toBeUndefined();
    expect(e.lerpFromY).toBeUndefined();
  });

  it('walk frame advances while Walking, idle resets when stopping', async () => {
    const { scene, conn } = await createTestScene();
    scene.time = 0;
    const e = spawnPlayer(scene, conn, 1, 0, 0); // spawns Walking
    // currentAction === Walking → animation advances even without movement.
    tickEntity(scene, e, 0.3);
    expect(e.walkFrame).toBeGreaterThan(0);

    // Server flips to Idle and visual is already at position → animation stops.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{
          entityId: 1,
          components: { currentAction: { actionType: ActionType.Idle } },
        }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    tickEntity(scene, e, 0.01);
    expect(e.walkFrame).toBe(0);
  });

  it('keeps animating while visual lags position even after server says Idle', async () => {
    // Reproduces the "slides into final tile" case: server flips to Idle in
    // the same delta as the final position update; the lerp still has work
    // to do and the visual-lag check keeps animation alive.
    const { scene, conn } = await createTestScene();
    scene.time = 0;
    const e = spawnPlayer(scene, conn, 1, 0, 0);
    // Idle the entity at origin so currentAction alone can't drive animation.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{
          entityId: 1,
          components: { currentAction: { actionType: ActionType.Idle } },
        }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    tickEntity(scene, e, 0.01);
    expect(e.walkFrame).toBe(0);

    // Final-tile delta: position jumps to (1,0) but action is already Idle.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 2,
        entityUpdates: [{ entityId: 1, components: { position: { tileX: 1, tileY: 0 } } }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    scene.time = DURATION_MS / 2;
    tickEntity(scene, e, 0.3);
    expect(e.walkFrame).toBeGreaterThan(0);

    // Visual catches up → animation stops on its own.
    scene.time = DURATION_MS * 2;
    tickEntity(scene, e, 0.01);
    expect(e.walkFrame).toBe(0);
  });
});
