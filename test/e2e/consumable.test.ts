import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';

describe('E2E: Consumable', () => {
  it('bandage heals player over 10 ticks', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Reduce HP to 50
    world.entities.health.set(player, { currentHp: 50, maxHp: 100 });

    // Give bandage
    world.inventoryMgr.addItem(player, BlueprintType.Bandage, 1);
    const inv = world.inventoryMgr.get(player)!;
    const bandage = inv.items.find(i => i.blueprintId === BlueprintType.Bandage)!;
    world.entities.clearDirty();

    // Use bandage
    world.setAction(player, { action: ClientAction.UseConsumable, itemId: bandage.itemId });
    world.runTicks(10);

    // Assert HP = 80 (50 + 30)
    const hp = world.entities.health.get(player)!;
    expect(hp.currentHp).toBe(80);

    // Bandage consumed
    const invAfter = world.inventoryMgr.get(player)!;
    const bandageAfter = invAfter.items.find(i => i.blueprintId === BlueprintType.Bandage);
    expect(bandageAfter).toBeUndefined();
  });

  it('consuming interrupted by movement cancels heal', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Reduce HP to 50
    world.entities.health.set(player, { currentHp: 50, maxHp: 100 });

    // Give bandage
    world.inventoryMgr.addItem(player, BlueprintType.Bandage, 1);
    const inv = world.inventoryMgr.get(player)!;
    const bandage = inv.items.find(i => i.blueprintId === BlueprintType.Bandage)!;
    world.entities.clearDirty();

    // Use bandage
    world.setAction(player, { action: ClientAction.UseConsumable, itemId: bandage.itemId });
    world.runTicks(3); // Not enough (bandage takes 10 ticks)

    // Verify consuming state
    const ca = world.entities.currentAction.get(player)!;
    expect(ca.actionType).toBe(ActionType.Consuming);

    // Move to cancel
    world.setAction(player, { action: ClientAction.MoveTo, tileX: 12, tileY: 10 });
    world.runTicks(1);

    // Assert HP still 50, bandage still in inventory
    const hp = world.entities.health.get(player)!;
    expect(hp.currentHp).toBe(50);

    const invAfter = world.inventoryMgr.get(player)!;
    const bandageAfter = invAfter.items.find(i => i.blueprintId === BlueprintType.Bandage);
    expect(bandageAfter).toBeDefined();
    expect(bandageAfter!.quantity).toBe(1);
  });

  it('cooked fish heals quickly', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Reduce HP to 80
    world.entities.health.set(player, { currentHp: 80, maxHp: 100 });

    // Give cooked fish
    world.inventoryMgr.addItem(player, BlueprintType.CookedFish, 1);
    const inv = world.inventoryMgr.get(player)!;
    const fish = inv.items.find(i => i.blueprintId === BlueprintType.CookedFish)!;
    world.entities.clearDirty();

    // Use cooked fish
    world.setAction(player, { action: ClientAction.UseConsumable, itemId: fish.itemId });
    world.runTicks(3); // CookedFish has consumeTicks: 3

    // Assert HP restored by 15 (80 + 15 = 95)
    const hp = world.entities.health.get(player)!;
    expect(hp.currentHp).toBe(95);

    // Fish consumed
    const invAfter = world.inventoryMgr.get(player)!;
    const fishAfter = invAfter.items.find(i => i.blueprintId === BlueprintType.CookedFish);
    expect(fishAfter).toBeUndefined();
  });

  it('heal does not exceed maxHp', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    // Only missing 5 HP
    world.entities.health.set(player, { currentHp: 95, maxHp: 100 });

    world.inventoryMgr.addItem(player, BlueprintType.CookedFish, 1);
    const inv = world.inventoryMgr.get(player)!;
    const fish = inv.items.find(i => i.blueprintId === BlueprintType.CookedFish)!;
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.UseConsumable, itemId: fish.itemId });
    world.runTicks(3);

    const hp = world.entities.health.get(player)!;
    expect(hp.currentHp).toBe(100); // Capped at maxHp, not 110
  });

  it('non-consumable item is ignored', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    world.entities.health.set(player, { currentHp: 50, maxHp: 100 });

    // Give a non-consumable (wood)
    world.inventoryMgr.addItem(player, BlueprintType.Wood, 1);
    const inv = world.inventoryMgr.get(player)!;
    const wood = inv.items.find(i => i.blueprintId === BlueprintType.Wood)!;
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.UseConsumable, itemId: wood.itemId });
    world.runTicks(5);

    // HP unchanged, action is idle (not consuming)
    const hp = world.entities.health.get(player)!;
    expect(hp.currentHp).toBe(50);
  });
});
