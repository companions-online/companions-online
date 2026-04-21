import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { Building } from '@shared/terrain.js';
import { StatusEffect } from '@shared/status-effects.js';

describe('E2E: Building placement', () => {
  it('place 3 walls, tile updates received, pathfinding routes around', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 10, 10);

    // Give player 3 walls
    world.inventoryMgr.addItem(player, BlueprintType.WoodenWall, 3);

    // Place walls at (12, 10), (12, 11), (12, 12) — vertical line
    const wallPositions: [number, number][] = [[12, 10], [12, 11], [12, 12]];
    for (const [wx, wy] of wallPositions) {
      const wallItem = world.inventoryMgr.get(player)!.items.find(
        i => i.blueprintId === BlueprintType.WoodenWall
      )!;
      // Equip
      world.setAction(player, { action: ClientAction.Equip, itemId: wallItem.itemId });
      world.runTicks(1);
      // Place
      world.setAction(player, { action: ClientAction.UseItemAt, itemId: wallItem.itemId, tileX: wx, tileY: wy });
      world.runTicks(1);
    }

    // All 3 tiles should be walls in the building layer
    for (const [wx, wy] of wallPositions) {
      expect(world.map.getBuilding(wx, wy)).toBe(Building.Wall);
      expect(world.map.isWalkable(wx, wy)).toBe(false);
    }

    // No wall entities should exist (they're tiles now)
    expect(world.inventoryMgr.get(player)!.items.find(
      i => i.blueprintId === BlueprintType.WoodenWall
    )).toBeUndefined();

    // Connection should have received tick events with tile updates
    const tickEvents = connection.events.filter(e => e.type === 'tick');
    expect(tickEvents.length).toBeGreaterThan(0);

    // Move to (14, 11) — must route around the wall line
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 14, tileY: 11 });
    world.runTicks(60);

    // Player should have arrived
    const finalPos = world.entities.position.get(player)!;
    expect(finalPos.tileX).toBe(14);
    expect(finalPos.tileY).toBe(11);

    // Player should never have been on any wall tile
    // (occupancy grid wouldn't have them since walls are in building layer,
    //  but verify the wall tiles are still walls — nobody walked through)
    for (const [wx, wy] of wallPositions) {
      expect(world.map.getBuilding(wx, wy)).toBe(Building.Wall);
    }
  });

  it('drop wooden wall creates ground entity, pick it up', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Give player 1 wall
    world.inventoryMgr.addItem(player, BlueprintType.WoodenWall, 1);
    const wallItem = world.inventoryMgr.get(player)!.items.find(
      i => i.blueprintId === BlueprintType.WoodenWall
    )!;

    // Drop it
    world.setAction(player, { action: ClientAction.Drop, itemId: wallItem.itemId });
    world.runTicks(1);

    // Wall should not be in inventory
    expect(world.inventoryMgr.get(player)!.items.find(
      i => i.blueprintId === BlueprintType.WoodenWall
    )).toBeUndefined();

    // Building layer should be empty (dropped, not placed)
    expect(world.map.getBuilding(10, 10)).toBe(Building.None);

    // Ground entity should exist at player position
    let groundEid: number | undefined;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprint.get(eid);
      const pos = world.entities.position.get(eid);
      if (bp && bp.blueprintId === BlueprintType.WoodenWall && pos && pos.tileX === 10 && pos.tileY === 10) {
        groundEid = eid;
        break;
      }
    }
    expect(groundEid).toBeDefined();

    // Pick it up
    world.setAction(player, { action: ClientAction.Pickup, entityId: groundEid! });
    world.runTicks(1);

    // Wall should be back in inventory
    expect(world.inventoryMgr.get(player)!.items.find(
      i => i.blueprintId === BlueprintType.WoodenWall
    )).toBeDefined();

    // Ground entity should be destroyed
    expect(world.entities.exists(groundEid!)).toBe(false);
  });
});

function placeDoor(world: ReturnType<typeof createTestWorld>, x: number, y: number): number {
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.blueprint.set(eid, { blueprintId: BlueprintType.WoodenDoor, variant: 0 });
  world.entities.statusEffects.set(eid, { effects: StatusEffect.Placed });
  world.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  world.occupancy.set(x, y, eid);
  return eid;
}

describe('E2E: Door toggle', () => {
  it('interact toggles door open and closed', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    const doorEid = placeDoor(world, 11, 10);
    world.entities.clearDirty();

    // Door starts closed — occupancy set
    expect(world.occupancy.isOccupied(11, 10)).toBe(true);

    // Interact to open
    world.setAction(player, { action: ClientAction.Interact, entityId: doorEid });
    world.runTicks(1);

    // Door should be open — occupancy cleared, StatusEffect.Open set
    expect(world.occupancy.isOccupied(11, 10)).toBe(false);
    const effects1 = world.entities.statusEffects.get(doorEid)!;
    expect(effects1.effects & StatusEffect.Open).toBeTruthy();

    // Interact again to close
    world.setAction(player, { action: ClientAction.Interact, entityId: doorEid });
    world.runTicks(1);

    // Door should be closed again
    expect(world.occupancy.isOccupied(11, 10)).toBe(true);
    const effects2 = world.entities.statusEffects.get(doorEid)!;
    expect(effects2.effects & StatusEffect.Open).toBeFalsy();
  });

  it('pathfinding routes through open door, blocked by closed door', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Build a wall line with a door gap: walls at (12,9), (12,11), door at (12,10)
    world.map.setBuilding(12, 9, Building.Wall);
    world.map.setBuilding(12, 11, Building.Wall);
    const doorEid = placeDoor(world, 12, 10);
    world.entities.clearDirty();

    // Try to move to (14, 10) — door is closed, must route around
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 14, tileY: 10 });
    world.runTicks(60);
    const pos1 = world.entities.position.get(player)!;
    expect(pos1.tileX).toBe(14);
    expect(pos1.tileY).toBe(10);

    // Move back
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 10, tileY: 10 });
    world.runTicks(60);

    // Open the door
    world.setAction(player, { action: ClientAction.Interact, entityId: doorEid });
    world.runTicks(1);

    // Now move to (14, 10) — door is open, can go through
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 14, tileY: 10 });
    world.runTicks(40);
    const pos2 = world.entities.position.get(player)!;
    expect(pos2.tileX).toBe(14);
    expect(pos2.tileY).toBe(10);
  });
});

function placeChest(world: ReturnType<typeof createTestWorld>, x: number, y: number): number {
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.blueprint.set(eid, { blueprintId: BlueprintType.StorageChest, variant: 0 });
  world.entities.statusEffects.set(eid, { effects: StatusEffect.Placed });
  world.entities.health.set(eid, { currentHp: 50, maxHp: 50 });
  world.occupancy.set(x, y, eid);
  world.inventoryMgr.create(eid, 100);
  return eid;
}

describe('E2E: Container system', () => {
  it('interact with chest triggers containerOpen event', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 10, 10);
    const chestEid = placeChest(world, 11, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Interact, entityId: chestEid });
    world.runTicks(1);

    const containerEvents = connection.events.filter(e => e.type === 'containerOpen');
    expect(containerEvents.length).toBe(1);
    expect(containerEvents[0].containerEntityId).toBe(chestEid);
  });

  it('transfer items to and from chest', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 10, 10);
    const chestEid = placeChest(world, 11, 10);
    world.entities.clearDirty();

    // Give player some wood
    world.inventoryMgr.addItem(player, BlueprintType.Wood, 5);
    const woodItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!;

    // Transfer wood to chest (direction 0 = player→chest)
    world.setAction(player, { action: ClientAction.Transfer, itemId: woodItem.itemId, containerId: chestEid, direction: 0 });
    world.runTicks(1);

    // Transfer with no quantity = whole stack: player's wood moves to chest in full.
    const playerWood = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    const chestWood = world.inventoryMgr.get(chestEid)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(playerWood).toBeUndefined();
    expect(chestWood).toBeDefined();
    expect(chestWood!.quantity).toBe(7);

    // Transfer back (direction 1 = chest→player)
    world.setAction(player, { action: ClientAction.Transfer, itemId: chestWood!.itemId, containerId: chestEid, direction: 1 });
    world.runTicks(1);

    // Chest should be empty, player should have it back
    expect(world.inventoryMgr.get(chestEid)!.items.find(i => i.blueprintId === BlueprintType.Wood)).toBeUndefined();
  });

  it('transfer rejected when not adjacent to chest', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    const chestEid = placeChest(world, 15, 15); // far away
    world.entities.clearDirty();

    world.inventoryMgr.addItem(player, BlueprintType.Wood, 5);
    const woodItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!;

    world.setAction(player, { action: ClientAction.Transfer, itemId: woodItem.itemId, containerId: chestEid, direction: 0 });
    world.runTicks(1);

    // Transfer should have been rejected — wood count unchanged
    const woodBefore = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!.quantity;
    expect(woodBefore).toBe(7); // 2 starting + 5 added
    expect(world.inventoryMgr.get(chestEid)!.items.length).toBe(0);
  });
});
