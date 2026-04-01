import WebSocket from 'ws';
import { MAP_SIZE, CHUNK_SIZE, VIEW_RANGE, INTEREST_RANGE } from '../shared/src/constants.js';
import { Terrain, Building } from '../shared/src/terrain.js';
import { tileChar } from '../shared/src/ascii.js';
import { BlueprintType, getBlueprint } from '../shared/src/blueprints.js';
import { ClientAction, ActionType } from '../shared/src/actions.js';
import {
  decodeServerMessage, encodeAction,
} from '../shared/src/protocol/codec.js';
import type { EntityComponents, DecodedAction, SyncedInventoryItem } from '../shared/src/protocol/codec.js';
import { resolveAction, describeAction } from '../shared/src/action-resolver.js';
import type { ActionContext } from '../shared/src/action-resolver.js';
import { getAllRecipes } from '../shared/src/recipes.js';
import type { Recipe } from '../shared/src/recipes.js';
import { canCraft, equipSlotToNumber, numberToEquipSlot } from '../shared/src/inventory.js';

// --- State ---
const terrainGrid = new Uint8Array(MAP_SIZE * MAP_SIZE);
const buildingsGrid = new Uint8Array(MAP_SIZE * MAP_SIZE);
const entityMap = new Map<number, EntityComponents & { speed?: number }>();

let myEntityId = 0;
let cursorDX = 0;
let cursorDY = 0;
let lastTick = 0;
let panelMode: 'none' | 'debug' | 'inventory' | 'crafting' | 'container' | 'dialogue' = 'none';
let invCursor = 0;
let inventory: SyncedInventoryItem[] = [];
let prevInventory: SyncedInventoryItem[] = [];
let harvestCount = 0;
let harvestItemName = '';
const debugLog: string[] = [];
const DEBUG_MAX = 200;

// Container state
let containerEntityId = 0;
let containerItems: SyncedInventoryItem[] = [];
let containerCursor = 0;
let containerSide: 'player' | 'chest' = 'chest';

// Dialogue state
let isDead = false;
let deathTime = 0;
let dialogueNpcId = 0;
let dialogueData: { greeting: string; options: { optionId: number; label: string; type: string; response?: string; trades?: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number }[] }[] } | null = null;

function dbg(line: string) {
  debugLog.push(line);
  if (debugLog.length > DEBUG_MAX) debugLog.shift();
}

// --- Connect ---
const host = process.argv[2] || 'localhost:3001';
const ws = new WebSocket(`ws://${host}`);
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  dbg('-- connected --');
  render();
});

ws.on('message', (data) => {
  const buf = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
  const msg = decodeServerMessage(buf);

  switch (msg.type) {
    case 'welcome':
      myEntityId = msg.entityId;
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
          terrainGrid[gi] = t[ci];
          buildingsGrid[gi] = b[ci];
        }
      }
      dbg(`← Chunk (${chunkX},${chunkY})`);
      break;
    }

    case 'entityFullState': {
      const { entityId, components, speed } = msg.data;
      entityMap.set(entityId, { ...components, speed });
      const pos = components.position;
      const bpId = components.blueprintId?.blueprintId;
      dbg(`← Full #${entityId} bp=${bpId ?? '?'} pos=${pos ? `(${pos.tileX},${pos.tileY})` : '?'}`);
      break;
    }

    case 'worldDelta': {
      const d = msg.data;
      lastTick = d.tick;
      for (const eu of d.entityUpdates) {
        const existing = entityMap.get(eu.entityId) ?? {};
        entityMap.set(eu.entityId, { ...existing, ...eu.components });
        // Clear harvest tracking when my entity stops harvesting
        if (eu.entityId === myEntityId && eu.components.currentAction) {
          const at = eu.components.currentAction.actionType;
          if (at === ActionType.Dead && !isDead) {
            isDead = true;
            deathTime = Date.now();
          } else if (at !== ActionType.Dead && isDead) {
            isDead = false;
          }
          if (at !== ActionType.Harvesting && harvestCount > 0) {
            // Keep the display for one more render, then clear
            setTimeout(() => { harvestCount = 0; harvestItemName = ''; render(); }, 1500);
          }
        }
      }
      for (const rid of d.entityRemovals) {
        entityMap.delete(rid);
      }
      for (const tu of d.tileUpdates) {
        const gi = tu.tileY * MAP_SIZE + tu.tileX;
        if (tu.terrain !== undefined) terrainGrid[gi] = tu.terrain;
        if (tu.building !== undefined) buildingsGrid[gi] = tu.building;
      }
      dbg(`← Delta t=${d.tick} upd=${d.entityUpdates.length} rem=${d.entityRemovals.length} tiles=${d.tileUpdates.length}`);
      break;
    }

    case 'inventorySync': {
      prevInventory = inventory;
      inventory = msg.items;
      if (invCursor >= inventory.length) invCursor = Math.max(0, inventory.length - 1);

      // Track harvest yields by diffing inventory
      const myAction = entityMap.get(myEntityId)?.currentAction;
      const actionType = myAction && 'actionType' in myAction ? myAction.actionType : undefined;
      if (actionType === ActionType.Harvesting && prevInventory.length > 0) {
        // Find what was added
        for (const item of inventory) {
          const prev = prevInventory.find(p => p.blueprintId === item.blueprintId);
          const prevQty = prev?.quantity ?? 0;
          if (item.quantity > prevQty) {
            const delta = item.quantity - prevQty;
            harvestCount += delta;
            harvestItemName = getBlueprint(item.blueprintId)?.name ?? '?';
          }
        }
      }

      dbg(`← Inv ${msg.items.length} items`);
      break;
    }

    case 'containerOpen': {
      containerEntityId = msg.containerEntityId;
      containerItems = msg.items;
      containerCursor = 0;
      containerSide = 'chest';
      if (panelMode !== 'container') {
        panelMode = 'container';
        process.stdout.write('\x1b[2J');
      }
      dbg(`← Container #${msg.containerEntityId} ${msg.items.length} items`);
      break;
    }

    case 'dialogueOpen': {
      dialogueNpcId = msg.npcEntityId;
      dialogueData = msg.dialogue as typeof dialogueData;
      if (panelMode !== 'dialogue') {
        panelMode = 'dialogue';
        process.stdout.write('\x1b[2J');
      }
      dbg(`← Dialogue NPC #${msg.npcEntityId}`);
      break;
    }

    case 'pong':
      break;
  }

  render();
});

ws.on('close', () => { cleanup(); console.log('Disconnected.'); process.exit(0); });
ws.on('error', (err) => { cleanup(); console.error('Connection error:', err.message); process.exit(1); });

// --- Helpers ---
function sendAction(action: DecodedAction) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeAction(action));
  }
}

function buildCursorContext(playerX: number, playerY: number, dx: number, dy: number): ActionContext | null {
  const tx = playerX + dx;
  const ty = playerY + dy;
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return null;

  const gi = ty * MAP_SIZE + tx;
  const t = terrainGrid[gi] as Terrain;
  const b = buildingsGrid[gi] as Building;
  const isWalkable = !(t === Terrain.Water || t === Terrain.Rock || t === Terrain.River)
    && (b === Building.None || b === Building.Floor || b === Building.Door);
  const entAt = entityAtWorldTile(tx, ty);
  const handItem = inventory.find(i => i.equippedSlot === 1);

  return {
    targetX: tx,
    targetY: ty,
    isWalkable,
    terrainType: t,
    entityAtTarget: entAt,
    equippedHandBlueprintId: handItem?.blueprintId,
  };
}

function entityAtWorldTile(wx: number, wy: number): { entityId: number; blueprintId: number; isGroundItem?: boolean } | undefined {
  const key = wy * MAP_SIZE + wx;
  for (const [eid, comp] of entityMap) {
    if (!comp.position || comp.blueprintId === undefined) continue;
    const bpId = typeof comp.blueprintId === 'number'
      ? comp.blueprintId
      : (comp.blueprintId as { blueprintId: number }).blueprintId;
    if (comp.position.tileY * MAP_SIZE + comp.position.tileX === key && eid !== myEntityId) {
      // Ground items have no health component — placed structures do
      const isGroundItem = !comp.health;
      return { entityId: eid, blueprintId: bpId, isGroundItem };
    }
  }
  return undefined;
}

// --- Rendering ---
function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const myEntity = entityMap.get(myEntityId);
  const playerX = myEntity?.position?.tileX ?? 0;
  const playerY = myEntity?.position?.tileY ?? 0;

  const statusRows = 2;
  const mapRows = rows - statusRows;

  const panelWidth = panelMode !== 'none' ? 42 : 0;
  const mapCols = cols - panelWidth;

  const halfW = Math.floor(mapCols / 2);
  const halfH = Math.floor(mapRows / 2);

  // Build entity position lookup
  const entityAtTile = new Map<number, { bp: number; effects: number; dead: boolean }>();
  for (const [, comp] of entityMap) {
    if (comp.position && comp.blueprintId !== undefined) {
      const bpId = typeof comp.blueprintId === 'number'
        ? comp.blueprintId
        : (comp.blueprintId as { blueprintId: number }).blueprintId;
      const effects = comp.statusEffects
        ? (typeof comp.statusEffects === 'number' ? comp.statusEffects : (comp.statusEffects as { effects: number }).effects)
        : 0;
      const dead = comp.currentAction !== undefined &&
        typeof comp.currentAction !== 'number' &&
        (comp.currentAction as { actionType: number }).actionType === ActionType.Dead;
      entityAtTile.set(comp.position.tileY * MAP_SIZE + comp.position.tileX, { bp: bpId, effects, dead });
    }
  }

  let out = '\x1b[H';

  for (let vy = 0; vy < mapRows; vy++) {
    const wy = playerY - halfH + vy;
    let line = '';

    for (let vx = 0; vx < mapCols; vx++) {
      const wx = playerX - halfW + vx;
      const dx = vx - halfW;
      const dy = vy - halfH;
      const isCursor = panelMode === 'none' && dx === cursorDX && dy === cursorDY;

      let ch: string;
      if (wx < 0 || wx >= MAP_SIZE || wy < 0 || wy >= MAP_SIZE ||
          Math.abs(wx - playerX) > INTEREST_RANGE || Math.abs(wy - playerY) > INTEREST_RANGE) {
        ch = ' ';
      } else {
        const gi = wy * MAP_SIZE + wx;
        const t = terrainGrid[gi] as Terrain;
        const b = buildingsGrid[gi] as Building;
        const entData = entityAtTile.get(gi);
        if (entData?.dead) {
          ch = 'X';
        } else {
          ch = tileChar(t, b, entData?.bp as BlueprintType | undefined, entData?.effects);
        }
      }

      if (isCursor) {
        line += `\x1b[7m${ch}\x1b[0m`;
      } else {
        line += ch;
      }
    }

    // Right panel
    if (panelWidth > 0) {
      line += '\x1b[90m│\x1b[0m';
      const pw = panelWidth - 2;
      let panelLine = '';

      if (panelMode === 'debug') {
        const dbgIdx = debugLog.length - mapRows + vy;
        panelLine = dbgIdx >= 0 && dbgIdx < debugLog.length ? debugLog[dbgIdx] : '';
      } else if (panelMode === 'inventory') {
        panelLine = renderInventoryLine(vy, mapRows, pw);
      } else if (panelMode === 'crafting') {
        panelLine = renderCraftingLine(vy, mapRows, pw);
      } else if (panelMode === 'container') {
        panelLine = renderContainerLine(vy, mapRows, pw);
      } else if (panelMode === 'dialogue') {
        panelLine = renderDialogueLine(vy, mapRows, pw);
      }

      line += panelLine.slice(0, pw).padEnd(pw);
    }

    out += line + '\n';
  }

  // Status bar
  const cursorWorldX = playerX + cursorDX;
  const cursorWorldY = playerY + cursorDY;
  const wt = inventory.reduce((s, i) => s + (getBlueprint(i.blueprintId)?.weight ?? 0) * i.quantity, 0);
  // Speculative action label for status bar
  const cursorCtx = buildCursorContext(playerX, playerY, cursorDX, cursorDY);
  const cursorAction = cursorCtx ? resolveAction(cursorCtx) : null;
  const actionLabel = describeAction(cursorAction, cursorCtx ?? undefined);

  // Health display
  const myHp = myEntity?.health;
  const hpStr = myHp ? `HP:${(myHp as any).currentHp}/${(myHp as any).maxHp}` : 'HP:?';

  // Activity status
  const myAction = myEntity?.currentAction;
  const actionType = myAction && 'actionType' in myAction ? (myAction as any).actionType : undefined;
  const isCurrentlyHarvesting = actionType === ActionType.Harvesting;
  const isCurrentlyAttacking = actionType === ActionType.Attacking;

  let activityStatus = '';
  if (isDead) {
    const elapsed = (Date.now() - deathTime) / 1000;
    const remaining = Math.max(0, Math.ceil(5 - elapsed));
    activityStatus = ` | DEAD - Respawning in ${remaining}s...`;
  } else if (harvestCount > 0) {
    activityStatus = ` | +${harvestCount} ${harvestItemName}`;
  } else if (isCurrentlyHarvesting) {
    activityStatus = ' | Harvesting...';
  } else if (isCurrentlyAttacking && myAction && 'targetEntity' in myAction) {
    const targetEid = (myAction as any).targetEntity;
    const targetComp = entityMap.get(targetEid);
    const targetBpId = targetComp?.blueprintId;
    const bpId = targetBpId && typeof targetBpId !== 'number' ? (targetBpId as any).blueprintId : targetBpId;
    const targetBp = bpId !== undefined ? getBlueprint(bpId) : undefined;
    const targetHp = targetComp?.health;
    const thpStr = targetHp ? `${(targetHp as any).currentHp}/${(targetHp as any).maxHp}` : '';
    activityStatus = ` | Attacking ${targetBp?.name ?? '?'} ${thpStr}`;
  }

  const status1 = ` ${hpStr} (${playerX},${playerY}) Cursor(${cursorWorldX},${cursorWorldY}) E:${entityMap.size} T:${lastTick} W:${wt}/50${activityStatus}`;
  const keys = panelMode === 'none'
    ? ` [arrows]move [enter]${actionLabel} [u]se [i]nv [d]ebug [q]uit`
    : panelMode === 'inventory'
    ? ' [↑↓]select [e]quip [g]drop [c]raft [i]close'
    : panelMode === 'crafting'
    ? ' [↑↓]select [enter]craft [c]back [i]close'
    : panelMode === 'container'
    ? ' [↑↓]select [tab]side [enter]transfer [esc]close'
    : panelMode === 'dialogue'
    ? ' [1-9]select [esc]close'
    : ' [d]close [q]uit';

  out += `\x1b[7m${status1.padEnd(cols)}\x1b[0m\n`;
  out += `\x1b[7m${keys.padEnd(cols)}\x1b[0m`;

  process.stdout.write(out);
}

function renderInventoryLine(vy: number, totalRows: number, maxW: number): string {
  if (vy === 0) return '\x1b[1mINVENTORY\x1b[0m';
  if (vy === 1) return '';

  const itemIdx = vy - 2;
  if (itemIdx >= 0 && itemIdx < inventory.length) {
    const item = inventory[itemIdx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    let slotPrefix = '    ';
    if (item.equippedSlot === 1) slotPrefix = '[H] ';
    else if (item.equippedSlot === 2) slotPrefix = '[B] ';
    else if (item.equippedSlot === 3) slotPrefix = '[^] ';

    const selected = itemIdx === invCursor;
    const text = `${selected ? '>' : ' '} ${slotPrefix}${name}${qty}`;
    return selected ? `\x1b[7m${text}\x1b[0m` : text;
  }

  const footerStart = Math.max(inventory.length + 3, totalRows - 3);
  if (vy === footerStart) {
    const wt = inventory.reduce((s, i) => s + (getBlueprint(i.blueprintId)?.weight ?? 0) * i.quantity, 0);
    return `Weight: ${wt}/50`;
  }
  return '';
}

function renderCraftingLine(vy: number, totalRows: number, maxW: number): string {
  if (vy === 0) return '\x1b[1mCRAFTING\x1b[0m';
  if (vy === 1) return '';

  const recipes = getAllRecipes();
  // Build a simple inventory for canCraft check
  const inv = { items: inventory.map(i => ({ itemId: i.itemId, blueprintId: i.blueprintId, quantity: i.quantity, equippedSlot: numberToEquipSlot(i.equippedSlot) })), maxWeight: 50 };

  const recipeIdx = vy - 2;
  if (recipeIdx >= 0 && recipeIdx < recipes.length) {
    const recipe = recipes[recipeIdx];
    const outBp = getBlueprint(recipe.output.blueprintId);
    const outName = outBp?.name ?? '?';
    const inputs = recipe.inputs.map(inp => {
      const ibp = getBlueprint(inp.blueprintId);
      return `${inp.quantity} ${ibp?.name ?? '?'}`;
    }).join(', ');
    const craftable = canCraft(recipe, inv);
    const selected = recipeIdx === invCursor;
    const prefix = selected ? '>' : ' ';
    const text = `${prefix} ${outName} (${inputs})`;
    if (!craftable) return `\x1b[90m${text}\x1b[0m`;
    return selected ? `\x1b[7m${text}\x1b[0m` : text;
  }
  return '';
}

function renderContainerLine(vy: number, _totalRows: number, _maxW: number): string {
  const chestHeader = 0;
  const chestStart = 1;
  const chestEnd = chestStart + containerItems.length;
  const sep = chestEnd + 1;
  const invHeader = sep + 1;
  const invStart = invHeader + 1;

  if (vy === chestHeader) return '\x1b[1mCHEST\x1b[0m';
  if (vy >= chestStart && vy < chestEnd) {
    const idx = vy - chestStart;
    const item = containerItems[idx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const sel = containerSide === 'chest' && idx === containerCursor;
    const text = `${sel ? '>' : ' '} ${name}${qty}`;
    return sel ? `\x1b[7m${text}\x1b[0m` : text;
  }
  if (vy === sep) return '\x1b[90m────────────────────\x1b[0m';
  if (vy === invHeader) return '\x1b[1mYOUR INVENTORY\x1b[0m';
  const invIdx = vy - invStart;
  if (invIdx >= 0 && invIdx < inventory.length) {
    const item = inventory[invIdx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const sel = containerSide === 'player' && invIdx === containerCursor;
    const text = `${sel ? '>' : ' '} ${name}${qty}`;
    return sel ? `\x1b[7m${text}\x1b[0m` : text;
  }
  return '';
}

function renderDialogueLine(vy: number, _totalRows: number, _maxW: number): string {
  if (!dialogueData) return '';
  if (vy === 0) {
    const npcComp = entityMap.get(dialogueNpcId);
    const bpId = npcComp?.blueprintId;
    const id = bpId && typeof bpId !== 'number' ? (bpId as { blueprintId: number }).blueprintId : bpId as number;
    const name = id !== undefined ? getBlueprint(id)?.name ?? 'NPC' : 'NPC';
    return `\x1b[1m${name}\x1b[0m`;
  }
  if (vy === 1) return `"${dialogueData.greeting}"`;
  if (vy === 2) return '';

  const optIdx = vy - 3;
  if (optIdx >= 0 && optIdx < dialogueData.options.length) {
    const opt = dialogueData.options[optIdx];
    if (opt.trades && opt.trades.length > 0) {
      // Show trade list inline
      const lines: string[] = [];
      for (const t of opt.trades) {
        const giveBp = getBlueprint(t.givesBlueprint);
        const wantBp = getBlueprint(t.wantsBlueprint);
        if (t.wantsBlueprint === 0) {
          lines.push(`  [${t.tradeId}] FREE: ${t.givesQty} ${giveBp?.name ?? '?'}`);
        } else {
          lines.push(`  [${t.tradeId}] ${t.wantsQty} ${wantBp?.name ?? '?'} -> ${t.givesQty} ${giveBp?.name ?? '?'}`);
        }
      }
      // For simplicity, show option label + first trade on this line
      if (optIdx === 0) return `[${opt.optionId}] ${opt.label}`;
      return lines[optIdx - 1] ?? '';
    }
    return `[${opt.optionId}] ${opt.label}`;
  }

  // Show trade offers if the first option has trades (trade view)
  if (dialogueData.options.length === 1 && dialogueData.options[0].trades) {
    const trades = dialogueData.options[0].trades;
    const tradeIdx = vy - 3 - 1; // after the option label
    if (tradeIdx >= 0 && tradeIdx < trades.length) {
      const t = trades[tradeIdx];
      const giveBp = getBlueprint(t.givesBlueprint);
      const wantBp = getBlueprint(t.wantsBlueprint);
      if (t.wantsBlueprint === 0) {
        return ` [${t.tradeId}] FREE: ${t.givesQty} ${giveBp?.name ?? '?'}`;
      }
      return ` [${t.tradeId}] ${t.wantsQty} ${wantBp?.name ?? '?'} -> ${t.givesQty} ${giveBp?.name ?? '?'}`;
    }
  }

  return '';
}

// --- Input ---
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
  if (isDead) {
    render();
    return;
  }

  // Panel toggles
  if (key === 'd' && panelMode !== 'inventory' && panelMode !== 'crafting') {
    panelMode = panelMode === 'debug' ? 'none' : 'debug';
    process.stdout.write('\x1b[2J');
    render();
    return;
  }

  if (key === 'i') {
    if (panelMode === 'inventory' || panelMode === 'crafting') {
      panelMode = 'none';
    } else {
      panelMode = 'inventory';
      invCursor = 0;
    }
    process.stdout.write('\x1b[2J');
    render();
    return;
  }

  // --- Inventory mode ---
  if (panelMode === 'inventory') {
    if (key === '\x1b[A') { invCursor = Math.max(0, invCursor - 1); }
    else if (key === '\x1b[B') { invCursor = Math.min(inventory.length - 1, invCursor + 1); }
    else if (key === 'e' && inventory.length > 0) {
      const item = inventory[invCursor];
      if (item) {
        if (item.equippedSlot > 0) {
          sendAction({ action: ClientAction.Unequip, slot: item.equippedSlot });
          dbg(`→ Unequip slot=${item.equippedSlot}`);
        } else {
          sendAction({ action: ClientAction.Equip, itemId: item.itemId });
          dbg(`→ Equip itemId=${item.itemId}`);
        }
      }
    }
    else if (key === 'g' && inventory.length > 0) {
      const item = inventory[invCursor];
      if (item) {
        sendAction({ action: ClientAction.Drop, itemId: item.itemId });
        dbg(`→ Drop itemId=${item.itemId}`);
      }
    }
    else if (key === 'c') {
      panelMode = 'crafting';
      invCursor = 0;
      process.stdout.write('\x1b[2J');
    }
    else if (key === '\x1b' && key.length === 1) {
      panelMode = 'none';
      process.stdout.write('\x1b[2J');
    }
    render();
    return;
  }

  // --- Crafting mode ---
  if (panelMode === 'crafting') {
    const recipes = getAllRecipes();
    if (key === '\x1b[A') { invCursor = Math.max(0, invCursor - 1); }
    else if (key === '\x1b[B') { invCursor = Math.min(recipes.length - 1, invCursor + 1); }
    else if (key === '\r' || key === '\n') {
      if (invCursor >= 0 && invCursor < recipes.length) {
        sendAction({ action: ClientAction.Craft, recipeId: recipes[invCursor].id });
        dbg(`→ Craft recipe=${recipes[invCursor].id}`);
      }
    }
    else if (key === 'c' || (key === '\x1b' && key.length === 1)) {
      panelMode = 'inventory';
      invCursor = 0;
      process.stdout.write('\x1b[2J');
    }
    render();
    return;
  }

  // --- Container mode ---
  if (panelMode === 'container') {
    const items = containerSide === 'chest' ? containerItems : inventory;
    if (key === '\x1b[A') { containerCursor = Math.max(0, containerCursor - 1); }
    else if (key === '\x1b[B') { containerCursor = Math.min(items.length - 1, containerCursor + 1); }
    else if (key === '\t') {
      containerSide = containerSide === 'chest' ? 'player' : 'chest';
      containerCursor = 0;
    }
    else if (key === '\r' || key === '\n') {
      if (items.length > 0 && containerCursor < items.length) {
        const item = items[containerCursor];
        const dir = containerSide === 'player' ? 0 : 1;
        sendAction({ action: ClientAction.Transfer, itemId: item.itemId, containerId: containerEntityId, direction: dir });
        dbg(`→ Transfer ${containerSide === 'player' ? '→chest' : '→player'} itemId=${item.itemId}`);
      }
    }
    else if (key === '\x1b' && key.length === 1) {
      panelMode = 'none';
      process.stdout.write('\x1b[2J');
    }
    render();
    return;
  }

  // --- Dialogue mode ---
  if (panelMode === 'dialogue') {
    if (key >= '1' && key <= '9') {
      const num = parseInt(key);
      if (dialogueData) {
        // Check if it's a trade number or option number
        const opt = dialogueData.options.find(o => o.optionId === num);
        if (opt) {
          if (opt.type === 'trade' && opt.trades) {
            // Send dialogue select to show trades
            sendAction({ action: ClientAction.DialogueSelect, npcEntityId: dialogueNpcId, optionId: num });
            dbg(`→ DialogueSelect option=${num}`);
          } else {
            sendAction({ action: ClientAction.DialogueSelect, npcEntityId: dialogueNpcId, optionId: num });
            dbg(`→ DialogueSelect option=${num}`);
          }
        } else {
          // Maybe it's a trade ID
          for (const o of dialogueData.options) {
            const trade = o.trades?.find(t => t.tradeId === num);
            if (trade) {
              sendAction({ action: ClientAction.Trade, npcEntityId: dialogueNpcId, tradeId: num });
              dbg(`→ Trade tradeId=${num}`);
              break;
            }
          }
        }
      }
    }
    else if (key === '\x1b' && key.length === 1) {
      panelMode = 'none';
      dialogueData = null;
      process.stdout.write('\x1b[2J');
    }
    render();
    return;
  }

  // --- Map mode (default) ---
  const maxRange = Math.floor(VIEW_RANGE / 2);

  if (key === '\x1b[A') { cursorDY = Math.max(-maxRange, cursorDY - 1); }
  else if (key === '\x1b[B') { cursorDY = Math.min(maxRange, cursorDY + 1); }
  else if (key === '\x1b[C') { cursorDX = Math.min(maxRange, cursorDX + 1); }
  else if (key === '\x1b[D') { cursorDX = Math.max(-maxRange, cursorDX - 1); }
  else if (key === '\r' || key === '\n') {
    doAction();
    return;
  }
  else if (key === 'u') {
    doUseItemAt();
    return;
  }
  else return;

  render();
});

function doAction() {
  const myEntity = entityMap.get(myEntityId);
  if (!myEntity?.position) return;

  const ctx = buildCursorContext(myEntity.position.tileX, myEntity.position.tileY, cursorDX, cursorDY);
  if (!ctx) return;

  const action = resolveAction(ctx);

  if (action) {
    sendAction(action);
    const label = describeAction(action, ctx);
    dbg(`→ ${label} (${ctx.targetX},${ctx.targetY})`);
    render();
  }
}

function doUseItemAt() {
  const myEntity = entityMap.get(myEntityId);
  if (!myEntity?.position) return;
  const handItem = inventory.find(i => i.equippedSlot === 1);
  if (!handItem) return;

  const tx = myEntity.position.tileX + cursorDX;
  const ty = myEntity.position.tileY + cursorDY;
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return;

  sendAction({ action: ClientAction.UseItemAt, itemId: handItem.itemId, tileX: tx, tileY: ty });
  dbg(`→ UseItemAt item=${handItem.itemId} at (${tx},${ty})`);
  render();
}

function cleanup() {
  process.stdout.write('\x1b[?25h');
  process.stdout.write('\x1b[0m');
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
}
