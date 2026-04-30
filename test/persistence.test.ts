import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNewWorld, saveWorld, loadWorld } from '../server/src/world-persistence.js';
import { TICKS_PER_GAME_HOUR } from '@shared/constants.js';
import { BlueprintType } from '@shared/blueprints.js';
import { StatusEffect, isPlaced } from '@shared/status-effects.js';
import { spawnCreatureEntity, spawnGroundItem } from '../server/src/entity-spawn.js';
import { depleteTree } from '../server/src/systems/resources.js';
import { createDefaultWorld } from '../server/src/game-world.js';

describe('World persistence: tickOffset', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const d of tempDirs) {
      await rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cotest-'));
    tempDirs.push(dir);
    return dir;
  }

  it('round-trips tickOffset through save + load', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);
    world.setTickOffset(3 * TICKS_PER_GAME_HOUR + 15);
    await saveWorld(world, worldDir, meta);

    const reloaded = await loadWorld(worldDir);
    expect(reloaded.world.tickOffset).toBe(3 * TICKS_PER_GAME_HOUR + 15);
    expect(reloaded.meta.tickOffset).toBe(3 * TICKS_PER_GAME_HOUR + 15);
  });

  it('ground items do not reacquire occupancy after reload', async () => {
    // Regression: skeleton-loot ground items left overnight in a saved world
    // re-entered the occupancy grid on load (loadWorld blindly called
    // occupancy.set for every saved entity), blocking spawn-area movement.
    // Post-fix: loadWorld classifier-dispatches by Placed bit so ground
    // items skip occupancy.
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);

    // Drop ground items at known coords. Mix of resource (Rock/Iron) and
    // item (Bandage) categories — all should reload as walk-through.
    const dropCoords: { bp: BlueprintType; x: number; y: number }[] = [
      { bp: BlueprintType.Rock, x: 50, y: 50 },
      { bp: BlueprintType.Iron, x: 51, y: 50 },
      { bp: BlueprintType.Iron, x: 52, y: 50 },
      { bp: BlueprintType.Bandage, x: 50, y: 51 },
    ];
    for (const d of dropCoords) {
      // Ground items overlap freely — occupancy isn't tracked. Pick free
      // tiles by clearing the cell first if worldgen happened to put
      // something there; the test is about post-load behavior.
      world.occupancy.clear(d.x, d.y, world.occupancy.get(d.x, d.y));
      spawnGroundItem(world, d.bp, d.x, d.y);
    }
    await saveWorld(world, worldDir, meta);

    const reloaded = await loadWorld(worldDir);
    for (const d of dropCoords) {
      expect(reloaded.world.occupancy.get(d.x, d.y)).toBe(0);
      expect(reloaded.world.occupancy.isOccupied(d.x, d.y)).toBe(false);
    }
    // Multiple ground items can coexist on one tile — occupancy is unaffected
    // (51,50) and (52,50) hold an Iron each; they're both walk-through.
  });

  it('tree resources round-trip with Placed bit and occupancy intact', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);

    // Find a tree from worldgen.
    let treeEid = 0;
    let treeX = 0, treeY = 0;
    for (const [eid, bp] of world.entities.blueprint) {
      if (bp.blueprintId === BlueprintType.Tree) {
        treeEid = eid;
        const pos = world.entities.position.get(eid)!;
        treeX = pos.tileX; treeY = pos.tileY;
        break;
      }
    }
    expect(treeEid).toBeGreaterThan(0);

    // Partially harvest: 5 → 3 wood remaining.
    depleteTree(treeEid, world);
    depleteTree(treeEid, world);
    expect(world.treeResources.get(treeEid)).toBe(3);

    await saveWorld(world, worldDir, meta);
    const reloaded = await loadWorld(worldDir);

    expect(reloaded.world.treeResources.get(treeEid)).toBe(3);
    expect(isPlaced(reloaded.world.entities.statusEffects.get(treeEid))).toBe(true);
    expect(reloaded.world.occupancy.get(treeX, treeY)).toBe(treeEid);
  });

  it('critter states round-trip with components intact', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);

    // Spawn a wolf at a known location, install a non-default critter state.
    const wolfX = 60, wolfY = 60;
    world.occupancy.clear(wolfX, wolfY, world.occupancy.get(wolfX, wolfY));
    const wolfEid = spawnCreatureEntity(world, BlueprintType.Wolf, wolfX, wolfY);
    world.critterStates.set(wolfEid, {
      idleTicksRemaining: 5,
      rng: 12345,
      behavior: 'aggro',
      targetEntityId: 99,
      aggroProbeCooldown: 10,
    });

    await saveWorld(world, worldDir, meta);
    const reloaded = await loadWorld(worldDir);

    const restored = reloaded.world.critterStates.get(wolfEid);
    expect(restored).toEqual({
      idleTicksRemaining: 5,
      rng: 12345,
      behavior: 'aggro',
      targetEntityId: 99,
      aggroProbeCooldown: 10,
    });
    // Components present + occupancy registered (wolves are creatures, no
    // Placed bit, but they DO occupy).
    expect(reloaded.world.entities.position.get(wolfEid)).toEqual({ tileX: wolfX, tileY: wolfY });
    expect(reloaded.world.entities.health.get(wolfEid)?.maxHp).toBe(20);
    expect(reloaded.world.occupancy.get(wolfX, wolfY)).toBe(wolfEid);
  });

  it('open door round-trips with occupancy cleared', async () => {
    // Doors clear occupancy when opened (toggleDoor) and re-set it when
    // closed. The Placed+Open status combo must round-trip without putting
    // the door back into the grid as a blocker — otherwise reload phases
    // it back to walk-through-but-occupied.
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);

    const doorX = 65, doorY = 65;
    world.occupancy.clear(doorX, doorY, world.occupancy.get(doorX, doorY));
    const doorEid = spawnCreatureEntity(world, BlueprintType.WoodenDoor, doorX, doorY);
    expect(world.occupancy.get(doorX, doorY)).toBe(doorEid); // closed = occupied

    // Open the door: clear occupancy + set Open bit (mirroring toggleDoor's
    // open branch).
    world.occupancy.clear(doorX, doorY, doorEid);
    world.entities.statusEffects.set(doorEid, { effects: StatusEffect.Placed | StatusEffect.Open });
    expect(world.occupancy.get(doorX, doorY)).toBe(0);

    await saveWorld(world, worldDir, meta);
    const reloaded = await loadWorld(worldDir);

    // Open door reloads as walk-through (occupancy clear), Placed+Open bits
    // intact, entity still at the same tile.
    expect(reloaded.world.occupancy.get(doorX, doorY)).toBe(0);
    const restoredEffects = reloaded.world.entities.statusEffects.get(doorEid)?.effects ?? 0;
    expect(restoredEffects & StatusEffect.Placed).toBeTruthy();
    expect(restoredEffects & StatusEffect.Open).toBeTruthy();
    expect(reloaded.world.entities.position.get(doorEid)).toEqual({ tileX: doorX, tileY: doorY });
  });

  it('createDefaultWorld and createNewWorld produce isomorphic worlds for the same seed', async () => {
    // Same spawn pipeline now backs both factories. Drift-detector: per-
    // blueprint counts, occupied-tile count, and statusEffects-byte sum
    // should match.
    const dir = await makeTempDir();
    const seed = 42;
    const def = createDefaultWorld(seed);
    const { world: fresh } = await createNewWorld(seed, dir);

    function summarise(w: ReturnType<typeof createDefaultWorld>) {
      const counts = new Map<number, number>();
      let effectsSum = 0;
      for (const [eid, bp] of w.entities.blueprint) {
        counts.set(bp.blueprintId, (counts.get(bp.blueprintId) ?? 0) + 1);
        effectsSum += w.entities.statusEffects.get(eid)?.effects ?? 0;
      }
      let occupied = 0;
      for (let y = 0; y < w.map.height; y++) {
        for (let x = 0; x < w.map.width; x++) {
          if (w.occupancy.isOccupied(x, y)) occupied++;
        }
      }
      return { counts, effectsSum, occupied };
    }

    const a = summarise(def);
    const b = summarise(fresh);
    expect([...a.counts.entries()].sort()).toEqual([...b.counts.entries()].sort());
    expect(a.effectsSum).toBe(b.effectsSum);
    expect(a.occupied).toBe(b.occupied);
  });

  it('loads legacy saves (no tickOffset field) as offset 0', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);
    // Simulate a pre-lighting save by stripping the field.
    const legacyMeta = { ...meta, tickOffset: undefined };
    delete (legacyMeta as { tickOffset?: number }).tickOffset;
    await saveWorld(world, worldDir, legacyMeta);
    // Overwrite meta.json without the field by re-saving; saveWorld above
    // would have set tickOffset from world, so manually re-write instead.
    const { writeFile } = await import('node:fs/promises');
    const stripped: { [k: string]: unknown } = { ...legacyMeta };
    delete stripped.tickOffset;
    await writeFile(join(worldDir, 'meta.json'), JSON.stringify(stripped, null, 2));

    const reloaded = await loadWorld(worldDir);
    expect(reloaded.world.tickOffset).toBe(0);
  });
});
