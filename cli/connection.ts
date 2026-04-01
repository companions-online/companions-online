import { CHUNK_SIZE, MAP_SIZE } from '../shared/src/constants.js';
import { ActionType } from '../shared/src/actions.js';
import { getBlueprint } from '../shared/src/blueprints.js';
import { decodeServerMessage } from '../shared/src/protocol/codec.js';
import { state, dbg, getActionType } from './state.js';
import type { DialogueData } from './state.js';

/**
 * Process an incoming server message (binary ArrayBuffer) and mutate shared state.
 * Calls renderFn() after every message to redraw the screen.
 */
export function handleServerMessage(data: ArrayBuffer | Buffer, renderFn: () => void): void {
  const buf = data instanceof ArrayBuffer
    ? data
    : (data as Buffer).buffer.slice(
        (data as Buffer).byteOffset,
        (data as Buffer).byteOffset + (data as Buffer).byteLength,
      ) as ArrayBuffer;
  const msg = decodeServerMessage(buf);

  switch (msg.type) {
    case 'welcome':
      state.myEntityId = msg.entityId;
      dbg(`← Welcome id=${msg.entityId}`);
      break;

    case 'chunk': {
      const { chunkX, chunkY, terrain: t, buildings: b } = msg.data;
      const sx = chunkX * CHUNK_SIZE;
      const sy = chunkY * CHUNK_SIZE;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const gi = (sy + ly) * MAP_SIZE + (sx + lx);
          const ci = ly * CHUNK_SIZE + lx;
          state.terrainGrid[gi] = t[ci];
          state.buildingsGrid[gi] = b[ci];
        }
      }
      dbg(`← Chunk (${chunkX},${chunkY})`);
      break;
    }

    case 'entityFullState': {
      const { entityId, components, speed } = msg.data;
      state.entityMap.set(entityId, { ...components, speed });
      const pos = components.position;
      const bpId = components.blueprintId?.blueprintId;
      dbg(`← Full #${entityId} bp=${bpId ?? '?'} pos=${pos ? `(${pos.tileX},${pos.tileY})` : '?'}`);
      break;
    }

    case 'worldDelta': {
      const d = msg.data;
      state.lastTick = d.tick;
      for (const eu of d.entityUpdates) {
        const existing = state.entityMap.get(eu.entityId) ?? {};
        state.entityMap.set(eu.entityId, { ...existing, ...eu.components });
        // Track death state and harvest end
        if (eu.entityId === state.myEntityId && eu.components.currentAction) {
          const at = getActionType(eu.components.currentAction);
          if (at === ActionType.Dead && !state.isDead) {
            state.isDead = true;
            state.deathTime = Date.now();
          } else if (at !== ActionType.Dead && state.isDead) {
            state.isDead = false;
          }
          if (at !== ActionType.Harvesting && state.harvestCount > 0) {
            setTimeout(() => { state.harvestCount = 0; state.harvestItemName = ''; renderFn(); }, 1500);
          }
        }
      }
      for (const rid of d.entityRemovals) {
        state.entityMap.delete(rid);
      }
      for (const tu of d.tileUpdates) {
        const gi = tu.tileY * MAP_SIZE + tu.tileX;
        if (tu.terrain !== undefined) state.terrainGrid[gi] = tu.terrain;
        if (tu.building !== undefined) state.buildingsGrid[gi] = tu.building;
      }
      dbg(`← Delta t=${d.tick} upd=${d.entityUpdates.length} rem=${d.entityRemovals.length} tiles=${d.tileUpdates.length}`);
      break;
    }

    case 'inventorySync': {
      state.prevInventory = state.inventory;
      state.inventory = msg.items;
      if (state.invCursor >= state.inventory.length) {
        state.invCursor = Math.max(0, state.inventory.length - 1);
      }

      // Track harvest yields by diffing inventory
      const myAction = state.entityMap.get(state.myEntityId)?.currentAction;
      const actionType = getActionType(myAction);
      if (actionType === ActionType.Harvesting && state.prevInventory.length > 0) {
        for (const item of state.inventory) {
          const prev = state.prevInventory.find(p => p.blueprintId === item.blueprintId);
          const prevQty = prev?.quantity ?? 0;
          if (item.quantity > prevQty) {
            const delta = item.quantity - prevQty;
            state.harvestCount += delta;
            state.harvestItemName = getBlueprint(item.blueprintId)?.name ?? '?';
          }
        }
      }

      dbg(`← Inv ${msg.items.length} items`);
      break;
    }

    case 'containerOpen': {
      state.containerEntityId = msg.containerEntityId;
      state.containerItems = msg.items;
      state.containerCursor = 0;
      state.containerSide = 'chest';
      if (state.panelMode !== 'container') {
        state.panelMode = 'container';
        process.stdout.write('\x1b[2J');
      }
      dbg(`← Container #${msg.containerEntityId} ${msg.items.length} items`);
      break;
    }

    case 'dialogueOpen': {
      state.dialogueNpcId = msg.npcEntityId;
      state.dialogueData = msg.dialogue as DialogueData;
      if (state.panelMode !== 'dialogue') {
        state.panelMode = 'dialogue';
        process.stdout.write('\x1b[2J');
      }
      dbg(`← Dialogue NPC #${msg.npcEntityId}`);
      break;
    }

    case 'pong':
      break;
  }

  renderFn();
}
