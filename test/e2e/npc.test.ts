import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { Direction } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { ActionType } from '@shared/actions.js';
import type { NPCDialogue } from '../../server/src/npc-dialogues.js';

function placeNPC(world: ReturnType<typeof createTestWorld>, bp: BlueprintType, x: number, y: number): number {
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.direction.set(eid, { dir: Direction.S });
  world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  world.entities.health.set(eid, { currentHp: 999, maxHp: 999 });
  world.entities.blueprintId.set(eid, { blueprintId: bp });
  world.entities.statusEffects.set(eid, { effects: 0 });
  world.occupancy.set(x, y, eid);
  return eid;
}

describe('E2E: NPC dialogue & trade', () => {
  it('interact with Trader opens dialogue', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 10, 10);
    const traderEid = placeNPC(world, BlueprintType.Trader, 11, 10);
    world.entities.clearDirty();

    world.setAction(player, { action: ClientAction.Interact, entityId: traderEid });
    world.runTicks(1);

    const dialogueEvents = connection.events.filter(e => e.type === 'dialogueOpen');
    expect(dialogueEvents.length).toBe(1);
    expect(dialogueEvents[0].npcEntityId).toBe(traderEid);
    const dialogue = dialogueEvents[0].dialogue as NPCDialogue;
    expect(dialogue.greeting).toContain('sellin');
  });

  it('DialogueSelect talk option returns response', () => {
    const world = createTestWorld();
    const { entityId: player, connection } = addTestPlayer(world, 10, 10);
    const hermitEid = placeNPC(world, BlueprintType.Hermit, 11, 10);
    world.entities.clearDirty();

    // Open dialogue
    world.setAction(player, { action: ClientAction.Interact, entityId: hermitEid });
    world.runTicks(1);

    // Select "Tell me about this place" (optionId 1)
    world.setAction(player, { action: ClientAction.DialogueSelect, npcEntityId: hermitEid, optionId: 1 });
    world.runTicks(1);

    const dialogueEvents = connection.events.filter(e => e.type === 'dialogueOpen');
    expect(dialogueEvents.length).toBe(2);
    const response = dialogueEvents[1].dialogue as NPCDialogue;
    expect(response.greeting).toContain('island');
  });

  it('trade with Trader swaps items', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    placeNPC(world, BlueprintType.Trader, 11, 10);
    world.entities.clearDirty();

    // Give player 5 Rock (+ the 1 Rock from starting inventory = 6 total)
    world.inventoryMgr.addItem(player, BlueprintType.Rock, 4);

    // Find the trader entity
    let traderEid = 0;
    for (const eid of world.entities.getAllEntities()) {
      const bp = world.entities.blueprintId.get(eid);
      if (bp?.blueprintId === BlueprintType.Trader) { traderEid = eid; break; }
    }

    // Trade 5 Rock → 1 Iron (tradeId 2 in Trader's wares)
    world.setAction(player, { action: ClientAction.Trade, npcEntityId: traderEid, tradeId: 2 });
    world.runTicks(1);

    // Player should have Iron now, Rock reduced
    const inv = world.inventoryMgr.get(player)!;
    const iron = inv.items.find(i => i.blueprintId === BlueprintType.Iron);
    expect(iron).toBeDefined();
    expect(iron!.quantity).toBe(1);
  });

  it('trade rejected when player lacks materials', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    const traderEid = placeNPC(world, BlueprintType.Trader, 11, 10);
    world.entities.clearDirty();

    // Player has only starting items (2 Wood, 1 Rock) — not enough for 5 Rock → 1 Iron trade
    world.setAction(player, { action: ClientAction.Trade, npcEntityId: traderEid, tradeId: 2 });
    world.runTicks(1);

    const inv = world.inventoryMgr.get(player)!;
    expect(inv.items.find(i => i.blueprintId === BlueprintType.Iron)).toBeUndefined();
  });

  it('Hermit first-time gift works once', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    const hermitEid = placeNPC(world, BlueprintType.Hermit, 11, 10);
    world.entities.clearDirty();

    const woodBefore = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!.quantity;

    // Trade for free Wood (tradeId 1)
    world.setAction(player, { action: ClientAction.Trade, npcEntityId: hermitEid, tradeId: 1 });
    world.runTicks(1);

    const woodAfter = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!.quantity;
    expect(woodAfter).toBe(woodBefore + 2);

    // Try again — should not give more
    world.setAction(player, { action: ClientAction.Trade, npcEntityId: hermitEid, tradeId: 1 });
    world.runTicks(1);

    const woodFinal = world.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood)!.quantity;
    expect(woodFinal).toBe(woodAfter); // unchanged
  });
});
