import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree, placeGroundItem } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { getAllRecipes } from '@shared/recipes.js';
import { Terrain, Building } from '@shared/terrain.js';

describe('E2E: Gather & Craft', () => {
  it('player walks to tree, harvests wood, tree depletes', () => {
    const world = createTestWorld();
    const treeEid = placeTree(world, 10, 10);
    const { entityId: player } = addTestPlayer(world, 8, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Harvest, tileX: 10, tileY: 10 });
    world.runTicks(200);

    expect(world.entities.exists(treeEid)).toBe(false);
    const inv = world.inventoryMgr.get(player)!;
    const wood = inv.items.find(i => i.blueprintId === BlueprintType.Wood);
    // Starter 2 wood + 5 harvested = 7
    expect(wood!.quantity).toBe(7);
  });

  it('player crafts axe from wood + rock', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 5, 5);
    // Player starts with 2 Wood + 1 Rock — exactly enough for Axe
    world.entities.clearDirty();

    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    world.setAction(player, { action: ClientAction.Craft, recipeId: axeRecipe.id });
    world.runTicks(1);

    const inv = world.inventoryMgr.get(player)!;
    expect(inv.items.find(i => i.blueprintId === BlueprintType.Axe)).toBeDefined();
    expect(inv.items.find(i => i.blueprintId === BlueprintType.Wood)).toBeUndefined();
    expect(inv.items.find(i => i.blueprintId === BlueprintType.Rock)).toBeUndefined();
  });

  it('player picks up ground item from distance', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 5, 5);
    const woodEid = placeGroundItem(world, BlueprintType.Iron, 15, 5);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Pickup, entityId: woodEid });
    world.runTicks(150);

    expect(world.entities.exists(woodEid)).toBe(false);
    const inv = world.inventoryMgr.get(player)!;
    expect(inv.items.some(i => i.blueprintId === BlueprintType.Iron)).toBe(true);
  });

  it('player equips and drops item', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 5, 5);
    world.inventoryMgr.addItem(player, BlueprintType.Axe, 1);
    const axeItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.entities.clearDirty();

    // Equip
    world.setAction(player, { action: ClientAction.Equip, itemId: axeItem.itemId });
    world.runTicks(1);
    expect(world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Axe)!.equippedSlot).toBe('hand');

    // Drop
    world.setAction(player, { action: ClientAction.Drop, itemId: axeItem.itemId });
    world.runTicks(1);
    expect(world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Axe)).toBeUndefined();

    // Ground entity should exist at player position
    let groundAxe = false;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprint.get(eid);
      if (bp && bp.blueprintId === BlueprintType.Axe) { groundAxe = true; break; }
    }
    expect(groundAxe).toBe(true);
  });

  it('player mines rock terrain', () => {
    const world = createTestWorld({
      setupMap: (m) => { m.setTerrain(10, 5, Terrain.Rock); },
    });
    const { entityId: player } = addTestPlayer(world, 9, 5);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Harvest, tileX: 10, tileY: 5 });
    world.runTicks(15); // bare-hand = 10 ticks

    const inv = world.inventoryMgr.get(player)!;
    const rock = inv.items.find(i => i.blueprintId === BlueprintType.Rock);
    // starter 1 + harvested 1 = 2
    expect(rock!.quantity).toBe(2);
  });

  it('connection receives inventory events on craft', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 5, 5);
    world.entities.clearDirty();
    connection.events.length = 0; // clear init events

    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    world.setAction(player, { action: ClientAction.Craft, recipeId: axeRecipe.id });
    world.runTicks(1);

    const invEvents = connection.events.filter(e => e.type === 'inventory');
    expect(invEvents.length).toBeGreaterThan(0);
  });

  it('two players see each other move', () => {
    const world = createTestWorld();
    const { entityId: p1, connection: c1 } = addTestPlayer(world, 5, 5);
    const { entityId: p2, connection: c2 } = addTestPlayer(world, 7, 5);
    world.entities.clearDirty();
    c1.events.length = 0;
    c2.events.length = 0;

    // p1 moves
    world.setAction(p1, { action: ClientAction.MoveTo, tileX: 5, tileY: 8 });
    world.runTicks(50);

    // c2 should have tick events (seeing p1 move)
    const c2Ticks = c2.events.filter(e => e.type === 'tick');
    expect(c2Ticks.length).toBeGreaterThan(0);
  });

  it('player places crafted wall, it blocks movement', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 5, 5);
    // Give resources and craft a wall
    world.inventoryMgr.addItem(player, BlueprintType.Wood, 10);
    const wallRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.WoodenWall)!;
    world.setAction(player, { action: ClientAction.Craft, recipeId: wallRecipe.id });
    world.runTicks(1);

    // Equip wall
    const wallItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.WoodenWall)!;
    world.setAction(player, { action: ClientAction.Equip, itemId: wallItem.itemId });
    world.runTicks(1);

    // Place wall at (5, 7)
    world.setAction(player, { action: ClientAction.UseItemAt, itemId: wallItem.itemId, tileX: 5, tileY: 7 });
    world.runTicks(1);

    // Wall should be in building layer and block movement
    expect(world.map.getBuilding(5, 7)).toBe(Building.Wall);
    expect(world.map.isWalkable(5, 7)).toBe(false);
    expect(world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.WoodenWall)).toBeUndefined();
  });
});
