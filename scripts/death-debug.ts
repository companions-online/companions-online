import { createTestWorld, addTestPlayer } from './test/e2e/helpers.js';
import { BlueprintType } from './shared/src/blueprints.js';
import { ActionType } from './shared/src/actions.js';

const world = createTestWorld();
const { entityId: player } = addTestPlayer(world, 10, 10);
world.inventoryMgr.addItem(player, BlueprintType.IronSword, 1);
const swordItem = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.IronSword)!;
world.inventoryMgr.equip(player, swordItem.itemId);
world.entities.health.set(player, { currentHp: 1, maxHp: 100 });
world.entities.clearDirty();

// Directly simulate death by setting HP to 0 via combat
// Instead of wolf, just call handlePlayerDeath directly
(world as any).handlePlayerDeath(player);

const action = world.entities.currentAction.get(player);
console.log('After death:', action?.actionType, '(expected Dead=5)');
console.log('Respawn timers:', world.playerRespawnTimers.size);
console.log('Respawn tick:', [...world.playerRespawnTimers.values()][0]);
console.log('Current tick:', world.currentTick);

world.runTicks(101);
console.log('After 101 ticks:');
const action2 = world.entities.currentAction.get(player);
console.log('Action:', action2?.actionType, '(expected Idle=0)');
const hp2 = world.entities.health.get(player);
console.log('HP:', hp2?.currentHp);
