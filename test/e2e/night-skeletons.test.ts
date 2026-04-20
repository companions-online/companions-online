import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { BlueprintType } from '@shared/blueprints.js';
import { TICKS_PER_GAME_HOUR } from '@shared/constants.js';
import {
  SKELETON_MIN_PLAYER_DISTANCE,
  SKELETON_MAX_PLAYER_DISTANCE,
  SKELETON_SUN_DAMAGE,
  SKELETON_SUN_DAMAGE_TICKS,
} from '../../server/src/systems/creature-lifecycle.js';

function countSkeletons(world: ReturnType<typeof createTestWorld>): number {
  let n = 0;
  for (const [, bp] of world.entities.blueprint) {
    if (bp.blueprintId === BlueprintType.Skeleton) n++;
  }
  return n;
}

function firstSkeleton(world: ReturnType<typeof createTestWorld>): number | undefined {
  for (const [eid, bp] of world.entities.blueprint) {
    if (bp.blueprintId === BlueprintType.Skeleton) return eid;
  }
  return undefined;
}

function setHour(world: ReturnType<typeof createTestWorld>, hour: number): void {
  const targetTicks = hour * TICKS_PER_GAME_HOUR;
  const currentDayTick = world.currentTick % (24 * TICKS_PER_GAME_HOUR);
  const offset = ((targetTicks - currentDayTick) % (24 * TICKS_PER_GAME_HOUR)
    + 24 * TICKS_PER_GAME_HOUR) % (24 * TICKS_PER_GAME_HOUR);
  world.setTickOffset(offset);
}

describe('E2E: Night skeletons', () => {
  it('does not spawn skeletons during the day', () => {
    const world = createTestWorld();
    addTestPlayer(world, 64, 64);
    setHour(world, 12); // noon
    const baseline = countSkeletons(world);

    world.runTicks(3 * TICKS_PER_GAME_HOUR);

    expect(countSkeletons(world)).toBe(baseline);
  });

  it('spawns a skeleton at night within [MIN, MAX] of the player', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 64, 64);
    setHour(world, 1); // deep night

    // Over many in-game hours the night-spawn roll should fire at least once.
    // Rate is 1/720 per tick, so 20 hours ≈ 20 expected spawns; verify ≥1.
    world.runTicks(20 * TICKS_PER_GAME_HOUR);

    const skeleton = firstSkeleton(world);
    expect(skeleton).toBeDefined();
    const pos = world.entities.position.get(skeleton!)!;
    const playerPos = world.entities.position.get(player)!;
    const dist = Math.max(
      Math.abs(pos.tileX - playerPos.tileX),
      Math.abs(pos.tileY - playerPos.tileY),
    );
    expect(dist).toBeGreaterThanOrEqual(SKELETON_MIN_PLAYER_DISTANCE);
    expect(dist).toBeLessThanOrEqual(SKELETON_MAX_PLAYER_DISTANCE);
  });

  it('does not spawn in tiles covered by a campfire (point-light)', () => {
    const world = createTestWorld();
    addTestPlayer(world, 64, 64);
    setHour(world, 1);

    // Blanket the [MIN, MAX] annulus around the player with campfires by
    // tiling them on a grid step == 2*(radius+1) so their AABBs fully cover
    // the spawn region. Campfire lightRadius = 6 → step 14.
    const radius = 6;
    // step = 2*radius makes adjacent emitters' AABBs touch without gap
    // (Chebyshev coverage is inclusive at distance == radius).
    const step = 2 * radius;
    for (let dy = -SKELETON_MAX_PLAYER_DISTANCE - 2; dy <= SKELETON_MAX_PLAYER_DISTANCE + 2; dy += step) {
      for (let dx = -SKELETON_MAX_PLAYER_DISTANCE - 2; dx <= SKELETON_MAX_PLAYER_DISTANCE + 2; dx += step) {
        const x = 64 + dx;
        const y = 64 + dy;
        if (x === 64 && y === 64) continue; // don't clobber player
        world.spawnCreatureEntity(BlueprintType.Campfire, x, y);
      }
    }
    const baseline = countSkeletons(world);

    world.runTicks(20 * TICKS_PER_GAME_HOUR);

    expect(countSkeletons(world)).toBe(baseline);
  });

  it('day sun damage kills an existing skeleton', () => {
    const world = createTestWorld();
    addTestPlayer(world, 64, 64);
    setHour(world, 12);

    const skelEid = world.spawnCreatureEntity(BlueprintType.Skeleton, 80, 64);
    const maxHp = world.entities.health.get(skelEid)!.maxHp;
    const pulsesToKill = Math.ceil(maxHp / SKELETON_SUN_DAMAGE);

    // Run enough ticks for all pulses to land; include padding for the
    // modulo-aligned first pulse.
    world.runTicks(pulsesToKill * SKELETON_SUN_DAMAGE_TICKS + SKELETON_SUN_DAMAGE_TICKS);

    expect(world.entities.exists(skelEid)).toBe(false);
  });

  it('does not apply sun damage at night', () => {
    const world = createTestWorld();
    addTestPlayer(world, 64, 64);
    setHour(world, 1);

    const skelEid = world.spawnCreatureEntity(BlueprintType.Skeleton, 80, 64);
    const startHp = world.entities.health.get(skelEid)!.currentHp;

    world.runTicks(10 * SKELETON_SUN_DAMAGE_TICKS);

    const hp = world.entities.health.get(skelEid)?.currentHp;
    expect(hp).toBe(startHp);
  });

});
