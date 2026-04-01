import WebSocket from 'ws';
import { MAP_SIZE, VIEW_RANGE } from '../shared/src/constants.js';
import { ClientAction } from '../shared/src/actions.js';
import { getAllRecipes } from '../shared/src/recipes.js';
import { encodeAction } from '../shared/src/protocol/codec.js';
import type { DecodedAction } from '../shared/src/protocol/codec.js';
import { resolveAction, describeAction } from '../shared/src/action-resolver.js';
import { state, dbg } from './state.js';
import { buildCursorContext } from './render.js';

function sendAction(ws: WebSocket, action: DecodedAction) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeAction(action));
  }
}

function cleanup() {
  process.stdout.write('\x1b[?25h');
  process.stdout.write('\x1b[0m');
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
}

function doAction(ws: WebSocket, renderFn: () => void) {
  const myEntity = state.entityMap.get(state.myEntityId);
  if (!myEntity?.position) return;

  const ctx = buildCursorContext(myEntity.position.tileX, myEntity.position.tileY, state.cursorDX, state.cursorDY);
  if (!ctx) return;

  const action = resolveAction(ctx);

  if (action) {
    sendAction(ws, action);
    const label = describeAction(action, ctx);
    dbg(`→ ${label} (${ctx.targetX},${ctx.targetY})`);
    renderFn();
  }
}

function doUseItemAt(ws: WebSocket, renderFn: () => void) {
  const myEntity = state.entityMap.get(state.myEntityId);
  if (!myEntity?.position) return;
  const handItem = state.inventory.find(i => i.equippedSlot === 1);
  if (!handItem) return;

  const tx = myEntity.position.tileX + state.cursorDX;
  const ty = myEntity.position.tileY + state.cursorDY;
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return;

  sendAction(ws, { action: ClientAction.UseItemAt, itemId: handItem.itemId, tileX: tx, tileY: ty });
  dbg(`→ UseItemAt item=${handItem.itemId} at (${tx},${ty})`);
  renderFn();
}

export function setupInput(ws: WebSocket, renderFn: () => void): void {
  process.stdin.setRawMode!(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdout.write('\x1b[?25l');
  process.stdout.write('\x1b[2J');

  process.stdin.on('data', (key: string) => {
    if (key === 'q' || key === '\x03') {
      cleanup();
      ws.close();
      process.exit(0);
    }

    // Block all actions while dead (except quit)
    if (state.isDead) {
      renderFn();
      return;
    }

    // Panel toggles
    if (key === 'd' && state.panelMode !== 'inventory' && state.panelMode !== 'crafting') {
      state.panelMode = state.panelMode === 'debug' ? 'none' : 'debug';
      process.stdout.write('\x1b[2J');
      renderFn();
      return;
    }

    if (key === 'i') {
      if (state.panelMode === 'inventory' || state.panelMode === 'crafting') {
        state.panelMode = 'none';
      } else {
        state.panelMode = 'inventory';
        state.invCursor = 0;
      }
      process.stdout.write('\x1b[2J');
      renderFn();
      return;
    }

    // --- Inventory mode ---
    if (state.panelMode === 'inventory') {
      if (key === '\x1b[A') { state.invCursor = Math.max(0, state.invCursor - 1); }
      else if (key === '\x1b[B') { state.invCursor = Math.min(state.inventory.length - 1, state.invCursor + 1); }
      else if (key === 'e' && state.inventory.length > 0) {
        const item = state.inventory[state.invCursor];
        if (item) {
          if (item.equippedSlot > 0) {
            sendAction(ws, { action: ClientAction.Unequip, slot: item.equippedSlot });
            dbg(`→ Unequip slot=${item.equippedSlot}`);
          } else {
            sendAction(ws, { action: ClientAction.Equip, itemId: item.itemId });
            dbg(`→ Equip itemId=${item.itemId}`);
          }
        }
      }
      else if (key === 'g' && state.inventory.length > 0) {
        const item = state.inventory[state.invCursor];
        if (item) {
          sendAction(ws, { action: ClientAction.Drop, itemId: item.itemId });
          dbg(`→ Drop itemId=${item.itemId}`);
        }
      }
      else if (key === 'c') {
        state.panelMode = 'crafting';
        state.invCursor = 0;
        process.stdout.write('\x1b[2J');
      }
      else if (key === '\x1b' && key.length === 1) {
        state.panelMode = 'none';
        process.stdout.write('\x1b[2J');
      }
      renderFn();
      return;
    }

    // --- Crafting mode ---
    if (state.panelMode === 'crafting') {
      const recipes = getAllRecipes();
      if (key === '\x1b[A') { state.invCursor = Math.max(0, state.invCursor - 1); }
      else if (key === '\x1b[B') { state.invCursor = Math.min(recipes.length - 1, state.invCursor + 1); }
      else if (key === '\r' || key === '\n') {
        if (state.invCursor >= 0 && state.invCursor < recipes.length) {
          sendAction(ws, { action: ClientAction.Craft, recipeId: recipes[state.invCursor].id });
          dbg(`→ Craft recipe=${recipes[state.invCursor].id}`);
        }
      }
      else if (key === 'c' || (key === '\x1b' && key.length === 1)) {
        state.panelMode = 'inventory';
        state.invCursor = 0;
        process.stdout.write('\x1b[2J');
      }
      renderFn();
      return;
    }

    // --- Container mode ---
    if (state.panelMode === 'container') {
      const items = state.containerSide === 'chest' ? state.containerItems : state.inventory;
      if (key === '\x1b[A') { state.containerCursor = Math.max(0, state.containerCursor - 1); }
      else if (key === '\x1b[B') { state.containerCursor = Math.min(items.length - 1, state.containerCursor + 1); }
      else if (key === '\t') {
        state.containerSide = state.containerSide === 'chest' ? 'player' : 'chest';
        state.containerCursor = 0;
      }
      else if (key === '\r' || key === '\n') {
        if (items.length > 0 && state.containerCursor < items.length) {
          const item = items[state.containerCursor];
          const dir = state.containerSide === 'player' ? 0 : 1;
          sendAction(ws, { action: ClientAction.Transfer, itemId: item.itemId, containerId: state.containerEntityId, direction: dir });
          dbg(`→ Transfer ${state.containerSide === 'player' ? '→chest' : '→player'} itemId=${item.itemId}`);
        }
      }
      else if (key === '\x1b' && key.length === 1) {
        state.panelMode = 'none';
        process.stdout.write('\x1b[2J');
      }
      renderFn();
      return;
    }

    // --- Dialogue mode ---
    if (state.panelMode === 'dialogue') {
      if (key >= '1' && key <= '9') {
        const num = parseInt(key);
        if (state.dialogueData) {
          const opt = state.dialogueData.options.find(o => o.optionId === num);
          if (opt) {
            sendAction(ws, { action: ClientAction.DialogueSelect, npcEntityId: state.dialogueNpcId, optionId: num });
            dbg(`→ DialogueSelect option=${num}`);
          } else {
            for (const o of state.dialogueData.options) {
              const trade = o.trades?.find(t => t.tradeId === num);
              if (trade) {
                sendAction(ws, { action: ClientAction.Trade, npcEntityId: state.dialogueNpcId, tradeId: num });
                dbg(`→ Trade tradeId=${num}`);
                break;
              }
            }
          }
        }
      }
      else if (key === '\x1b' && key.length === 1) {
        state.panelMode = 'none';
        state.dialogueData = null;
        process.stdout.write('\x1b[2J');
      }
      renderFn();
      return;
    }

    // --- Map mode (default) ---
    const maxRange = Math.floor(VIEW_RANGE / 2);

    if (key === '\x1b[A') { state.cursorDY = Math.max(-maxRange, state.cursorDY - 1); }
    else if (key === '\x1b[B') { state.cursorDY = Math.min(maxRange, state.cursorDY + 1); }
    else if (key === '\x1b[C') { state.cursorDX = Math.min(maxRange, state.cursorDX + 1); }
    else if (key === '\x1b[D') { state.cursorDX = Math.max(-maxRange, state.cursorDX - 1); }
    else if (key === '\r' || key === '\n') {
      doAction(ws, renderFn);
      return;
    }
    else if (key === 'u') {
      doUseItemAt(ws, renderFn);
      return;
    }
    else return;

    renderFn();
  });
}
