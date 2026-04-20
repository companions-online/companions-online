import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { Direction } from '../../shared/src/direction.js';
import { ActionType } from '../../shared/src/actions.js';
import { WAYPOINT_NONE } from '../../shared/src/components.js';
import { ACTION_BASE_TICKS } from '@shared/constants.js';
import { initCritterAI } from '../../server/src/systems/critter-ai.js';

function placeCritter(world: ReturnType<typeof createTestWorld>, bp: BlueprintType, x: number, y: number): number {
  const bpDef = getBlueprint(bp)!;
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.direction.set(eid, { dir: Direction.S });
  world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  world.entities.health.set(eid, { currentHp: bpDef.maxHp ?? 10, maxHp: bpDef.maxHp ?? 10 });
  world.entities.blueprint.set(eid, { blueprintId: bp, variant: 0 });
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
    // fist: 1 dmg, base 2-tick swing; deer has 12 HP → 12 swings × 2 × ACTION_BASE_TICKS + pathfinding/slack
    world.runTicks(12 * 2 * ACTION_BASE_TICKS + 60);

    expect(world.entities.exists(deer)).toBe(false);

    // Check loot dropped: 2 Hide + 1 Raw Meat
    let hideCount = 0;
    let meatCount = 0;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprint.get(eid);
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
    // iron sword: 7 dmg, base 4-tick swing; deer (12 HP) dies in 2 swings × 4 × ACTION_BASE_TICKS + slack
    world.runTicks(2 * 4 * ACTION_BASE_TICKS + 20);

    expect(world.entities.exists(deer)).toBe(false);
  });

  it('wolf fights back when attacked', () => {
    const world = createTestWorld();
    const wolf = placeCritter(world, BlueprintType.Wolf, 10, 10);
    initCritterAI(world);
    const { entityId: player } = addTestPlayer(world, 9, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Attack, entityId: wolf });
    // ≥1 wolf swing at base 4-tick cooldown + aggro/pathfinding buffer
    world.runTicks(3 * 4 * ACTION_BASE_TICKS + 30);

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
    // iron sword: 7 dmg, base 4-tick swing; skeleton (25 HP) dies in 4 swings × 4 × ACTION_BASE_TICKS + pathfinding/slack
    world.runTicks(4 * 4 * ACTION_BASE_TICKS + 40);

    expect(world.entities.exists(skeleton)).toBe(false);

    // Check for at least iron or rock drop
    let hasIronOrRock = false;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprint.get(eid);
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

  it('player dies, drops equipped items, respawns after 100 ticks', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    world.entities.clearDirty();

    // Give player a sword and equip it, plus some unequipped wood
    world.inventoryMgr.addItem(player, BlueprintType.IronSword, 1);
    world.inventoryMgr.addItem(player, BlueprintType.Wood, 5);
    const swordItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.IronSword)!;
    world.inventoryMgr.equip(player, swordItem.itemId);

    // Set HP to 1 so next hit kills
    world.entities.health.set(player, { currentHp: 1, maxHp: 100 });

    // Place a wolf next to player — force the wolf to attack immediately
    const wolf = placeCritter(world, BlueprintType.Wolf, 11, 10);
    initCritterAI(world);
    // Override wolf idle to 0 so it aggros immediately
    const wolfState = world.critterStates.get(wolf);
    if (wolfState) wolfState.idleTicksRemaining = 0;
    world.entities.clearDirty();

    // Run enough ticks for wolf to aggro and deal damage: 1 wolf swing × 4 × ACTION_BASE_TICKS + aggro buffer
    world.runTicks(1 * 4 * ACTION_BASE_TICKS + 20);

    // Player entity should still exist (not destroyed)
    expect(world.entities.exists(player)).toBe(true);

    // Player should be dead
    const action = world.entities.currentAction.get(player);
    expect(action?.actionType).toBe(ActionType.Dead);

    // HP should be 0
    const hp = world.entities.health.get(player);
    expect(hp?.currentHp).toBe(0);

    // Sword should be on the ground as an entity at death position
    let swordOnGround = false;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprint.get(eid);
      const pos = world.entities.position.get(eid);
      if (bp?.blueprintId === BlueprintType.IronSword && pos?.tileX === 10 && pos?.tileY === 10) {
        swordOnGround = true;
        break;
      }
    }
    expect(swordOnGround).toBe(true);

    // Sword should not be in player inventory
    expect(world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.IronSword)).toBeUndefined();

    // Non-equipped items (wood, starting items) should still be in inventory
    expect(world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)).toBeDefined();

    // Actions should be blocked while dead
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 15, tileY: 15 });
    world.runTicks(1);
    const posStillDead = world.entities.position.get(player)!;
    expect(posStillDead.tileX).toBe(10); // didn't move

    // Wait for respawn (100 ticks from death)
    world.runTicks(110);

    // Player should be alive
    const actionAfter = world.entities.currentAction.get(player);
    expect(actionAfter?.actionType).toBe(ActionType.Idle);
    const hpAfter = world.entities.health.get(player);
    expect(hpAfter?.currentHp).toBe(100);
  });
});
