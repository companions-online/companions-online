/**
 * Player action dispatch layer.
 *
 * Extracted from game-world.ts. Every handler is a free function taking
 * the GameWorld as its first argument, matching the shape used by systems/*.
 * processAction is the single entry point; handle* are module-private.
 *
 * rejectAction lives here because every one of its callsites is a handler —
 * it's the plumbing that tells the actor why their action failed, and has
 * no consumers outside this file.
 */

import { ClientAction, ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint, blueprintToBuilding } from '@shared/blueprints.js';
import { Building, Terrain } from '@shared/terrain.js';
import { StatusEffect } from '@shared/status-effects.js';
import { findItem, getWeight, numberToEquipSlot } from '@shared/inventory.js';
import { getRecipe } from '@shared/recipes.js';
import { MetaKey } from '@shared/entity-meta.js';
import { INTEREST_RANGE } from '@shared/constants.js';
import type {
  DecodedAction,
  DecodedActionInteract, DecodedActionPickup, DecodedActionEquip,
  DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft,
  DecodedActionHarvest, DecodedActionUseItemAt, DecodedActionAttack,
  DecodedActionTransfer, DecodedActionDialogueSelect, DecodedActionTrade,
  DecodedActionUseConsumable, DecodedActionSay, DecodedActionServerCommand,
} from '@shared/protocol/codec.js';

import type { GameWorld, PlayerSlot } from './game-world.js';
import { Ok, Err, type RejectionReason, type ActionResult } from './action-rejection.js';
import { requireAdjacentTarget } from './action-helpers.js';
import { dispatchServerCommand } from './server-commands.js';
import { getDialogue } from './npc-dialogues.js';

import { setMoveTarget, clearMoveTarget } from './systems/movement.js';
import { startHarvest, cancelHarvest, isHarvesting } from './systems/harvest.js';
import { startAttack, cancelCombat, isInCombat } from './systems/combat.js';
import { startConsume, cancelConsume, isConsuming } from './systems/consumable.js';

// ---------------------------------------------------------------------------
// Rejection plumbing
// ---------------------------------------------------------------------------

/** Reject a pending action before it takes effect. Routes the structured
 *  reason to the player's connection so MCP tools can surface it with
 *  `isError: true`. Handlers run synchronously inside the 'actions' tick
 *  phase, so McpConnection resolves `awaitAction` immediately on receipt. */
export function rejectAction(world: GameWorld, entityId: number, reason: RejectionReason): void {
  const slot = world.players.get(entityId);
  if (slot) slot.connection.onActionRejected(entityId, reason);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function processAction(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  // Dead players can't act
  const ca = world.entities.currentAction.get(eid);
  if (ca && ca.actionType === ActionType.Dead) return;

  // Say is instant and must not cancel other actions
  if (action.action === ClientAction.Say) {
    handleSay(world, eid, action);
    return;
  }

  // Server commands (/nick, etc.) are instant and must not cancel other actions
  if (action.action === ClientAction.ServerCommand) {
    handleServerCommand(world, eid, slot, action);
    return;
  }

  cancelConflictingStates(world, eid, action);

  switch (action.action) {
    case ClientAction.MoveTo:    handleMoveTo(world, eid, action); break;
    case ClientAction.Cancel:    handleCancel(world, eid); break;
    case ClientAction.Pickup:    handlePickup(world, eid, slot, action); break;
    case ClientAction.Equip:     handleEquip(world, eid, slot, action); break;
    case ClientAction.Unequip:   handleUnequip(world, eid, slot, action); break;
    case ClientAction.Drop:      handleDrop(world, eid, slot, action); break;
    case ClientAction.Craft:     handleCraft(world, eid, slot, action); break;
    case ClientAction.Harvest:   handleHarvest(world, eid, action); break;
    case ClientAction.UseItemAt: {
      const a = action as DecodedActionUseItemAt;
      handleUseItemAt(world, eid, slot, a.itemId, a.tileX, a.tileY);
      break;
    }
    case ClientAction.Attack:          handleAttack(world, eid, action); break;
    case ClientAction.Interact:        handleInteractAction(world, eid, slot, action); break;
    case ClientAction.Transfer:        handleTransfer(world, eid, slot, action); break;
    case ClientAction.DialogueSelect:  handleDialogueSelect(world, eid, slot, action); break;
    case ClientAction.Trade:           handleTrade(world, eid, slot, action); break;
    case ClientAction.UseConsumable:   handleUseConsumable(world, eid, action); break;
  }
}

function cancelConflictingStates(world: GameWorld, eid: number, action: DecodedAction): void {
  if (action.action !== ClientAction.Harvest && isHarvesting(eid, world)) {
    world.emitEvent(eid, world.makeEvent('action_interrupted', {
      interruptedAction: 'harvesting', reason: 'new action',
    }));
    cancelHarvest(eid, world);
  }
  if (action.action !== ClientAction.Attack && isInCombat(eid, world)) {
    world.emitEvent(eid, world.makeEvent('action_interrupted', {
      interruptedAction: 'attacking', reason: 'new action',
    }));
    cancelCombat(eid, world);
  }
  if (action.action !== ClientAction.Pickup) {
    world.pendingPickups.delete(eid);
  }
  if (action.action !== ClientAction.Interact) {
    world.pendingInteracts.delete(eid);
  }
  if (action.action !== ClientAction.UseConsumable && isConsuming(eid, world)) {
    world.emitEvent(eid, world.makeEvent('action_interrupted', {
      interruptedAction: 'consuming', reason: 'new action',
    }));
    cancelConsume(eid, world);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleMoveTo(world: GameWorld, eid: number, action: DecodedAction): void {
  const a = action as { action: number; tileX: number; tileY: number };
  const r = setMoveTarget(eid, a.tileX, a.tileY, world, 'exact');
  if (!r.ok) rejectAction(world, eid, r.reason);
}

function handleCancel(world: GameWorld, eid: number): void {
  clearMoveTarget(eid, world);
}

function handlePickup(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionPickup;
  const playerPos = world.entities.position.get(eid);
  if (!playerPos) return;

  const targetPos = world.entities.position.get(a.entityId);
  const bp = world.entities.blueprint.get(a.entityId);
  if (!targetPos || !bp) {
    rejectAction(world, eid, { code: 'target_missing', targetEntityId: a.entityId });
    return;
  }

  const bpDef = getBlueprint(bp.blueprintId);
  if (!bpDef || (bpDef.category !== 'item' && bpDef.category !== 'resource' && bpDef.category !== 'placeable')) {
    rejectAction(world, eid, {
      code: 'wrong_target_kind', targetEntityId: a.entityId,
      expected: 'ground item', got: bpDef?.category ?? 'unknown',
    });
    return;
  }

  const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
  if (dist <= 1) {
    const result = world.inventoryMgr.addItem(eid, bp.blueprintId, 1);
    if (!result.success) {
      const inv = world.inventoryMgr.get(eid);
      rejectAction(world, eid, {
        code: 'inventory_full',
        weight: inv ? getWeight(inv) : 0,
        maxWeight: inv?.maxWeight ?? 0,
      });
      return;
    }
    // No occupancy.clear — ground items are not tracked by the occupancy grid.
    world.entities.destroy(a.entityId);
    slot.connection.onInventoryChanged(eid, world);
    world.emitEvent(eid, world.makeEvent('item_picked_up', {
      blueprintId: bp.blueprintId, itemName: world.bpName(bp.blueprintId), quantity: 1,
    }));
  } else {
    world.pendingPickups.set(eid, { targetEntityId: a.entityId });
    setMoveTarget(eid, targetPos.tileX, targetPos.tileY, world);
  }
}

function handleEquip(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionEquip;
  const r = world.inventoryMgr.equip(eid, a.itemId, a.quantity);
  if (!r.ok) { rejectAction(world, eid, r.reason); return; }
  slot.connection.onInventoryChanged(eid, world);
}

function handleUnequip(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionUnequip;
  const eqSlot = numberToEquipSlot(a.slot);
  if (!eqSlot) return;
  const r = world.inventoryMgr.unequip(eid, eqSlot);
  if (!r.ok) { rejectAction(world, eid, r.reason); return; }
  slot.connection.onInventoryChanged(eid, world);
}

function handleDrop(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionDrop;
  const r = world.inventoryMgr.drop(eid, a.itemId, a.quantity);
  if (!r.ok) { rejectAction(world, eid, r.reason); return; }
  const playerPos = world.entities.position.get(eid);
  if (playerPos) {
    const groundEid = world.entities.create();
    world.entities.position.set(groundEid, { tileX: playerPos.tileX, tileY: playerPos.tileY });
    world.entities.blueprint.set(groundEid, { blueprintId: r.value.blueprintId, variant: 0 });
  }
  slot.connection.onInventoryChanged(eid, world);
}

function handleCraft(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionCraft;
  const r = world.inventoryMgr.craft(eid, a.recipeId);
  if (!r.ok) { rejectAction(world, eid, r.reason); return; }
  const recipe = getRecipe(a.recipeId)!;
  slot.connection.onInventoryChanged(eid, world);
  const event = world.makeEvent('craft_complete', {
    crafterEntityId: eid,
    blueprintId: recipe.output.blueprintId,
    itemName: world.bpName(recipe.output.blueprintId),
    quantity: recipe.output.quantity,
  });
  world.emitEvent(eid, event);
  const pos = world.entities.position.get(eid);
  if (pos) world.broadcastEvent(pos.tileX, pos.tileY, event);
}

function handleHarvest(world: GameWorld, eid: number, action: DecodedAction): void {
  const a = action as DecodedActionHarvest;
  const r = startHarvest(eid, a.tileX, a.tileY, world);
  if (!r.ok) rejectAction(world, eid, r.reason);
}

function handleUseConsumable(world: GameWorld, eid: number, action: DecodedAction): void {
  const a = action as DecodedActionUseConsumable;
  clearMoveTarget(eid, world);
  const r = startConsume(eid, a.itemId, world);
  if (!r.ok) rejectAction(world, eid, r.reason);
}

function handleAttack(world: GameWorld, eid: number, action: DecodedAction): void {
  const a = action as DecodedActionAttack;
  clearMoveTarget(eid, world);
  const r = startAttack(eid, a.entityId, world);
  if (!r.ok) rejectAction(world, eid, r.reason);
}

function handleSay(world: GameWorld, eid: number, action: DecodedAction): void {
  const a = action as DecodedActionSay;
  const msg = a.message.slice(0, 200);
  const pos = world.entities.position.get(eid);
  if (!pos) return;
  const senderName = world.getEntityMeta(eid, MetaKey.Name) ?? 'Player';
  for (const [otherEid, otherSlot] of world.players) {
    const otherPos = world.entities.position.get(otherEid);
    if (!otherPos) continue;
    if (Math.abs(pos.tileX - otherPos.tileX) <= INTEREST_RANGE &&
        Math.abs(pos.tileY - otherPos.tileY) <= INTEREST_RANGE) {
      otherSlot.connection.onChatMessage(otherEid, eid, msg);
      world.emitEvent(otherEid, world.makeEvent('player_say', {
        senderEntityId: eid, senderName, message: msg,
      }));
    }
  }
}

function handleServerCommand(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionServerCommand;
  const result = dispatchServerCommand(world, eid, slot, a.command, a.parameter);
  if (!result.ok) {
    slot.connection.onChatMessage(eid, 0, `[system] ${result.error}`);
  }
}

function handleInteractAction(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionInteract;
  const playerPos = world.entities.position.get(eid);
  if (!playerPos) return;

  const targetPos = world.entities.position.get(a.entityId);
  if (!targetPos) {
    rejectAction(world, eid, { code: 'target_missing', targetEntityId: a.entityId });
    return;
  }

  const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX),
                        Math.abs(targetPos.tileY - playerPos.tileY));
  if (dist <= 1) {
    const r = executeInteract(world, eid, slot, a.entityId);
    if (!r.ok) rejectAction(world, eid, r.reason);
  } else {
    world.pendingInteracts.set(eid, { targetEntityId: a.entityId });
    setMoveTarget(eid, targetPos.tileX, targetPos.tileY, world);
  }
}

function handleTransfer(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionTransfer;
  const t = requireAdjacentTarget(eid, a.containerId, world);
  if (!t.ok) { rejectAction(world, eid, t.reason); return; }

  if (t.blueprintId !== BlueprintType.StorageChest) {
    rejectAction(world, eid, {
      code: 'wrong_target_kind', targetEntityId: a.containerId,
      expected: 'storage chest', got: world.bpName(t.blueprintId).toLowerCase(),
    });
    return;
  }

  const r = a.direction === 0
    ? world.inventoryMgr.transferToContainer(eid, a.containerId, a.itemId, a.quantity)
    : world.inventoryMgr.transferFromContainer(eid, a.containerId, a.itemId, a.quantity);
  if (!r.ok) { rejectAction(world, eid, r.reason); return; }
  slot.connection.onInventoryChanged(eid, world);
  slot.connection.onContainerOpen(eid, a.containerId, world);
}

function handleDialogueSelect(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionDialogueSelect;
  const t = requireAdjacentTarget(eid, a.npcEntityId, world);
  if (!t.ok) { rejectAction(world, eid, t.reason); return; }

  const dialogue = getDialogue(t.blueprintId);
  if (!dialogue) {
    rejectAction(world, eid, { code: 'dialogue_closed' });
    return;
  }

  const option = dialogue.options.find(o => o.optionId === a.optionId);
  if (!option) {
    rejectAction(world, eid, { code: 'dialogue_option_invalid', optionId: a.optionId });
    return;
  }

  if (option.type === 'talk' && option.response) {
    slot.connection.onDialogueOpen(eid, a.npcEntityId, {
      greeting: option.response,
      options: dialogue.options,
    });
  } else if (option.type === 'trade' && option.trades) {
    slot.connection.onDialogueOpen(eid, a.npcEntityId, {
      greeting: dialogue.greeting,
      options: [{ ...option }],
    });
  }
}

function handleTrade(world: GameWorld, eid: number, slot: PlayerSlot, action: DecodedAction): void {
  const a = action as DecodedActionTrade;
  const t = requireAdjacentTarget(eid, a.npcEntityId, world);
  if (!t.ok) { rejectAction(world, eid, t.reason); return; }

  const dialogue = getDialogue(t.blueprintId);
  if (!dialogue) {
    rejectAction(world, eid, { code: 'dialogue_closed' });
    return;
  }

  // Find the trade across all options
  let trade: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number } | undefined;
  for (const opt of dialogue.options) {
    if (opt.trades) trade = opt.trades.find(t => t.tradeId === a.tradeId);
    if (trade) break;
  }
  if (!trade) {
    rejectAction(world, eid, { code: 'trade_unavailable', tradeId: a.tradeId });
    return;
  }

  // Hermit first-time free gift check
  if (t.blueprintId === BlueprintType.Hermit && trade.wantsBlueprint === 0) {
    if (slot.playerFlags.has('hermit_gift')) {
      rejectAction(world, eid, { code: 'trade_unavailable', tradeId: a.tradeId });
      return;
    }
    world.inventoryMgr.addItem(eid, trade.givesBlueprint, trade.givesQty);
    slot.playerFlags.add('hermit_gift');
    slot.connection.onInventoryChanged(eid, world);
    world.emitEvent(eid, world.makeEvent('trade_complete', {
      npcEntityId: a.npcEntityId, npcName: world.bpName(t.blueprintId),
      gaveBlueprintId: 0, gaveName: '', gaveQuantity: 0,
      receivedBlueprintId: trade.givesBlueprint, receivedName: world.bpName(trade.givesBlueprint),
      receivedQuantity: trade.givesQty,
    }));
    return;
  }

  // Normal trade: check player has the required items
  if (trade.wantsBlueprint > 0) {
    const inv = world.inventoryMgr.get(eid);
    if (!inv) return;
    let have = 0;
    for (const item of inv.items) {
      if (item.blueprintId === trade.wantsBlueprint) have += item.quantity;
    }
    if (have < trade.wantsQty) {
      rejectAction(world, eid, { code: 'missing_materials', recipeId: a.tradeId });
      return;
    }
    let remaining = trade.wantsQty;
    for (let i = inv.items.length - 1; i >= 0 && remaining > 0; i--) {
      if (inv.items[i].blueprintId === trade.wantsBlueprint) {
        const take = Math.min(inv.items[i].quantity, remaining);
        world.inventoryMgr.removeItem(eid, inv.items[i].itemId, take);
        remaining -= take;
      }
    }
    world.inventoryMgr.addItem(eid, trade.givesBlueprint, trade.givesQty);
    slot.connection.onInventoryChanged(eid, world);
    world.emitEvent(eid, world.makeEvent('trade_complete', {
      npcEntityId: a.npcEntityId, npcName: world.bpName(t.blueprintId),
      gaveBlueprintId: trade.wantsBlueprint, gaveName: world.bpName(trade.wantsBlueprint),
      gaveQuantity: trade.wantsQty,
      receivedBlueprintId: trade.givesBlueprint, receivedName: world.bpName(trade.givesBlueprint),
      receivedQuantity: trade.givesQty,
    }));
  }
}

function handleUseItemAt(world: GameWorld, eid: number, slot: PlayerSlot, itemId: number, tileX: number, tileY: number): void {
  const playerPos = world.entities.position.get(eid);
  if (!playerPos) return;

  if (tileX < 0 || tileX >= world.map.width || tileY < 0 || tileY >= world.map.height) {
    rejectAction(world, eid, { code: 'tile_out_of_bounds', tileX, tileY });
    return;
  }

  const inv = world.inventoryMgr.get(eid);
  const item = inv ? findItem(inv, itemId) : undefined;
  if (!item) {
    rejectAction(world, eid, { code: 'item_missing', itemId });
    return;
  }

  const bp = getBlueprint(item.blueprintId);
  if (!bp) {
    rejectAction(world, eid, { code: 'item_missing', itemId });
    return;
  }

  // Cooking
  if (item.blueprintId === BlueprintType.RawFish || item.blueprintId === BlueprintType.RawMeat) {
    const campfireEid = world.occupancy.get(tileX, tileY);
    const campBp = campfireEid ? world.entities.blueprint.get(campfireEid) : undefined;
    if (!campfireEid || !campBp || campBp.blueprintId !== BlueprintType.Campfire) {
      rejectAction(world, eid, {
        code: 'wrong_target_kind', targetEntityId: campfireEid ?? 0,
        expected: 'campfire', got: campBp ? world.bpName(campBp.blueprintId).toLowerCase() : 'empty tile',
      });
      return;
    }
    const cookDist = Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY));
    if (cookDist > 1) {
      rejectAction(world, eid, { code: 'not_adjacent', targetEntityId: campfireEid, dist: cookDist });
      return;
    }

    const outputBp = item.blueprintId === BlueprintType.RawFish ? BlueprintType.CookedFish : BlueprintType.CookedMeat;
    world.inventoryMgr.removeItem(eid, itemId, 1);
    world.inventoryMgr.addItem(eid, outputBp, 1);
    slot.connection.onInventoryChanged(eid, world);
    world.emitEvent(eid, world.makeEvent('item_cooked', {
      inputBlueprintId: item.blueprintId, inputName: world.bpName(item.blueprintId),
      outputBlueprintId: outputBp, outputName: world.bpName(outputBp),
    }));
    return;
  }

  // Placing
  if (bp.category !== 'placeable') {
    rejectAction(world, eid, { code: 'not_placeable', itemId });
    return;
  }
  if (Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY)) > 2) {
    rejectAction(world, eid, { code: 'not_adjacent', targetEntityId: 0, dist: Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY)) });
    return;
  }
  if (!world.map.isWalkable(tileX, tileY) || world.occupancy.isOccupied(tileX, tileY)) {
    const building = world.map.getBuilding(tileX, tileY);
    const terrain = world.map.getTerrain(tileX, tileY);
    const by: 'wall' | 'water' | 'rock' | 'entity' =
      world.occupancy.isOccupied(tileX, tileY) ? 'entity'
      : building !== Building.None ? 'wall'
      : terrain === Terrain.Water || terrain === Terrain.River ? 'water'
      : 'rock';
    rejectAction(world, eid, { code: 'tile_blocked', tileX, tileY, by });
    return;
  }

  const buildingType = blueprintToBuilding(item.blueprintId);
  if (buildingType !== null) {
    if (world.map.getBuilding(tileX, tileY) !== Building.None) {
      rejectAction(world, eid, { code: 'tile_blocked', tileX, tileY, by: 'wall' });
      return;
    }
    world.inventoryMgr.removeItem(eid, itemId, 1);
    world.map.setBuilding(tileX, tileY, buildingType);
  } else {
    // Doors must stand in a wall gap — floor underneath, walls on opposite
    // sides. Relied on for elevation flattening and facing detection.
    if (item.blueprintId === BlueprintType.WoodenDoor) {
      const floor = world.map.getBuilding(tileX, tileY);
      if (floor !== Building.WoodenFloor && floor !== Building.StoneFloor) {
        rejectAction(world, eid, { code: 'tile_blocked', tileX, tileY, by: 'wall' });
        return;
      }
      const wallAt = (x: number, y: number) =>
        world.map.inBounds(x, y) && world.map.getBuilding(x, y) === Building.Wall;
      const ns = wallAt(tileX, tileY - 1) && wallAt(tileX, tileY + 1);
      const ew = wallAt(tileX - 1, tileY) && wallAt(tileX + 1, tileY);
      if (!ns && !ew) {
        rejectAction(world, eid, { code: 'tile_blocked', tileX, tileY, by: 'wall' });
        return;
      }
    }
    world.inventoryMgr.removeItem(eid, itemId, 1);
    const newEid = world.entities.create();
    world.entities.position.set(newEid, { tileX, tileY });
    world.entities.blueprint.set(newEid, { blueprintId: item.blueprintId, variant: 0 });
    world.entities.statusEffects.set(newEid, { effects: StatusEffect.Placed });
    if (bp.maxHp) world.entities.health.set(newEid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
    if (bp.collides) world.occupancy.set(tileX, tileY, newEid);
    if (item.blueprintId === BlueprintType.StorageChest) world.inventoryMgr.create(newEid, 100);
  }
  slot.connection.onInventoryChanged(eid, world);
  world.emitEvent(eid, world.makeEvent('building_placed', {
    blueprintId: item.blueprintId, itemName: world.bpName(item.blueprintId),
    tileX, tileY,
  }));
}

// ---------------------------------------------------------------------------
// Interact follow-through
// ---------------------------------------------------------------------------

/** Apply an interaction once the actor is adjacent to the target.
 *  Called from handleInteractAction (immediate case) and from the tick loop's
 *  pending-interact arrival path (deferred case). */
export function executeInteract(world: GameWorld, eid: number, slot: PlayerSlot, targetEntityId: number): ActionResult {
  const bp = world.entities.blueprint.get(targetEntityId);
  if (!bp) return Ok;
  switch (bp.blueprintId) {
    case BlueprintType.WoodenDoor:
      return toggleDoor(world, targetEntityId);
    case BlueprintType.StorageChest:
      slot.connection.onContainerOpen(eid, targetEntityId, world);
      return Ok;
    case BlueprintType.Hermit:
    case BlueprintType.Trader:
    case BlueprintType.Wanderer: {
      const npcBp = world.entities.blueprint.get(targetEntityId);
      if (npcBp) {
        const dialogue = getDialogue(npcBp.blueprintId);
        if (dialogue) slot.connection.onDialogueOpen(eid, targetEntityId, dialogue);
      }
      return Ok;
    }
  }
  return Ok;
}

function toggleDoor(world: GameWorld, doorEntityId: number): ActionResult {
  const pos = world.entities.position.get(doorEntityId);
  const effects = world.entities.statusEffects.get(doorEntityId);
  if (!pos || !effects) return Ok;

  const isOpen = (effects.effects & StatusEffect.Open) !== 0;
  if (isOpen) {
    // Closing: refuse if a non-door entity is standing on the tile. Slamming
    // the door shut would otherwise overwrite that entity's occupancy slot,
    // which cascades into a phantom-walkable-door state once the walker
    // steps off. Surface as a standard tile_blocked rejection.
    const occupant = world.occupancy.get(pos.tileX, pos.tileY);
    if (occupant !== 0 && occupant !== doorEntityId) {
      return Err({
        code: 'tile_blocked',
        tileX: pos.tileX, tileY: pos.tileY,
        by: 'entity',
      });
    }
    world.occupancy.set(pos.tileX, pos.tileY, doorEntityId);
    world.entities.statusEffects.set(doorEntityId, { effects: effects.effects & ~StatusEffect.Open });
  } else {
    world.occupancy.clear(pos.tileX, pos.tileY, doorEntityId);
    world.entities.statusEffects.set(doorEntityId, { effects: effects.effects | StatusEffect.Open });
  }
  return Ok;
}
