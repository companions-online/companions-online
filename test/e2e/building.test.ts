import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { Building } from '@shared/terrain.js';

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
      const bp = world.entities.blueprintId.get(eid);
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
