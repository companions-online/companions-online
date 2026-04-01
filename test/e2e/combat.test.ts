import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { Direction } from '../../shared/src/direction.js';
import { ActionType } from '../../shared/src/actions.js';
import { WAYPOINT_NONE } from '../../shared/src/components.js';
import { initCritterAI } from '../../server/src/systems/critter-ai.js';

function placeCritter(world: ReturnType<typeof createTestWorld>, bp: BlueprintType, x: number, y: number): number {
  const bpDef = getBlueprint(bp)!;
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.direction.set(eid, { dir: Direction.S });
  world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  world.entities.health.set(eid, { currentHp: bpDef.maxHp ?? 10, maxHp: bpDef.maxHp ?? 10 });
  world.entities.blueprintId.set(eid, { blueprintId: bp });
  world.entities.statusEffects.set(eid, { effects: 0 });
  if (bpDef.speed) world.entities.speed.set(eid, bpDef.speed);
  world.occupancy.set(x, y, eid);
  return eid;
}

describe('E2E: Combat', () => {
  it('player attacks deer, deer dies, drops loot', () => {
    const world = createTestWorld();
    const deer = placeCritter(world, BlueprintType.Deer, 10, 10);
    const { entityId: player } = addTestPlayer(world, 9, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: deer });
    world.runTicks(100); // fist: 1 dmg, 2 tick speed, deer has 12 HP → 24 ticks + pathfinding

    expect(world.entities.exists(deer)).toBe(false);

    // Check loot dropped: 2 Hide + 1 Raw Meat
    let hideCount = 0;
    let meatCount = 0;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprintId.get(eid);
      if (!bp) continue;
      const pos = world.entities.position.get(eid);
      if (!pos || pos.tileX !== 10 || pos.tileY !== 10) continue;
      if (bp.blueprintId === BlueprintType.Hide) hideCount++;
      if (bp.blueprintId === BlueprintType.RawMeat) meatCount++;
    }
    expect(hideCount).toBe(2);
    expect(meatCount).toBe(1);
  });

  it('weapon increases damage, kills faster', () => {
    const world = createTestWorld();
    const deer = placeCritter(world, BlueprintType.Deer, 10, 10);
    const { entityId: player } = addTestPlayer(world, 9, 10);

    // Give player iron sword (7 dmg, 4 tick speed)
    world.inventoryMgr.addItem(player, BlueprintType.IronSword, 1);
    const sword = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.IronSword)!;
    world.inventoryMgr.equip(player, sword.itemId);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: deer });
    world.runTicks(20); // 7 dmg per 4 ticks → deer (12 HP) dies in 2 swings = 8 ticks

    expect(world.entities.exists(deer)).toBe(false);
  });

  it('wolf fights back when attacked', () => {
    const world = createTestWorld();
    const wolf = placeCritter(world, BlueprintType.Wolf, 10, 10);
    initCritterAI(world);
    const { entityId: player } = addTestPlayer(world, 9, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: wolf });
    world.runTicks(30);

    // Player should have taken damage from wolf fighting back
    const playerHp = world.entities.health.get(player);
    expect(playerHp).toBeDefined();
    expect(playerHp!.currentHp).toBeLessThan(playerHp!.maxHp);
  });

  it('rabbit flees when player is nearby', () => {
    const world = createTestWorld();
    const rabbit = placeCritter(world, BlueprintType.Rabbit, 10, 10);
    initCritterAI(world);
    const { entityId: player } = addTestPlayer(world, 12, 10); // within flee range (3)
    world.entities.clearDirty();

    // Run some ticks for critter AI to react
    world.runTicks(30);

    // Rabbit should have moved away from player
    const rabbitPos = world.entities.position.get(rabbit);
    expect(rabbitPos).toBeDefined();
    const dist = Math.abs(rabbitPos!.tileX - 12) + Math.abs(rabbitPos!.tileY - 10);
    expect(dist).toBeGreaterThan(2); // should have fled
  });

  it('player auto-follows fleeing rabbit and kills it', () => {
    const world = createTestWorld();
    const rabbit = placeCritter(world, BlueprintType.Rabbit, 10, 10);
    initCritterAI(world);
    const { entityId: player } = addTestPlayer(world, 9, 10);
    world.entities.clearDirty();

    // Player attacks rabbit — rabbit has 3 HP, fist does 1 dmg
    world.setAction(player, { action: ClientAction.Attack, entityId: rabbit });
    world.runTicks(200); // enough to chase + kill

    expect(world.entities.exists(rabbit)).toBe(false);
  });

  it('bear aggros player who walks nearby', () => {
    const world = createTestWorld();
    const bear = placeCritter(world, BlueprintType.Bear, 10, 10);
    initCritterAI(world);
    const { entityId: player } = addTestPlayer(world, 13, 10); // within aggro range (4)
    world.entities.clearDirty();

    world.runTicks(20);

    // Bear should be attacking the player (combat state exists)
    expect(world.combatStates.has(bear)).toBe(true);
  });

  it('skeleton drops iron and rock on death', () => {
    const world = createTestWorld();
    const skeleton = placeCritter(world, BlueprintType.Skeleton, 10, 10);
    const { entityId: player } = addTestPlayer(world, 9, 10);

    // Give player a strong weapon to kill fast
    world.inventoryMgr.addItem(player, BlueprintType.IronSword, 1);
    const sword = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.IronSword)!;
    world.inventoryMgr.equip(player, sword.itemId);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: skeleton });
    world.runTicks(50);

    expect(world.entities.exists(skeleton)).toBe(false);

    // Check for at least iron or rock drop
    let hasIronOrRock = false;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprintId.get(eid);
      if (bp && (bp.blueprintId === BlueprintType.Iron || bp.blueprintId === BlueprintType.Rock)) {
        const pos = world.entities.position.get(eid);
        if (pos && pos.tileX === 10 && pos.tileY === 10) hasIronOrRock = true;
      }
    }
    expect(hasIronOrRock).toBe(true);
  });

  it('cancel attack stops combat', () => {
    const world = createTestWorld();
    const deer = placeCritter(world, BlueprintType.Deer, 10, 10);
    const { entityId: player } = addTestPlayer(world, 9, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: deer });
    world.runTicks(5);

    // Cancel
    world.setAction(player, { action: ClientAction.Cancel });
    world.runTicks(1);

    expect(world.combatStates.has(player)).toBe(false);
    expect(world.entities.exists(deer)).toBe(true); // deer still alive
  });
});
