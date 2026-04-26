import { MAP_SIZE, INTEREST_RANGE } from '../shared/src/constants.js';
import { Terrain, Building, isWalkable } from '../shared/src/terrain.js';
import { tileChar } from '../shared/src/ascii.js';
import { BlueprintType, getBlueprint } from '../shared/src/blueprints.js';
import { ActionType } from '../shared/src/actions.js';
import { isPlaced } from '../shared/src/status-effects.js';
import { resolveAction, describeAction } from '../shared/src/action-resolver.js';
import type { ActionContext } from '../shared/src/action-resolver.js';
import { state, getBpId, getEffects, getActionType, getHp } from './state.js';
import { renderInventoryLine, renderCraftingLine, renderContainerLine, renderDialogueLine } from './panels.js';

export function entityAtWorldTile(wx: number, wy: number): { entityId: number; blueprintId: number; isGroundItem?: boolean } | undefined {
  const key = wy * MAP_SIZE + wx;
  for (const [eid, comp] of state.entityMap) {
    if (!comp.position || comp.blueprint === undefined) continue;
    const bpId = getBpId(comp.blueprint);
    if (bpId === undefined) continue;
    if (comp.position.tileY * MAP_SIZE + comp.position.tileX === key && eid !== state.myEntityId) {
      // Placed structures carry StatusEffect.Placed; ground items don't.
      const isGroundItem = !isPlaced(comp.statusEffects);
      return { entityId: eid, blueprintId: bpId, isGroundItem };
    }
  }
  return undefined;
}

export function buildCursorContext(playerX: number, playerY: number, dx: number, dy: number): ActionContext | null {
  const tx = playerX + dx;
  const ty = playerY + dy;
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return null;

  const gi = ty * MAP_SIZE + tx;
  const t = state.terrainGrid[gi] as Terrain;
  const b = state.buildingsGrid[gi] as Building;
  const walkable = isWalkable(t, b);
  const entAt = entityAtWorldTile(tx, ty);
  const handItem = state.inventory.find(i => i.equippedSlot === 1);

  return {
    targetX: tx,
    targetY: ty,
    isWalkable: walkable,
    terrainType: t,
    entityAtTarget: entAt,
    equippedHandBlueprintId: handItem?.blueprintId,
  };
}

export function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const myEntity = state.entityMap.get(state.myEntityId);
  const playerX = myEntity?.position?.tileX ?? 0;
  const playerY = myEntity?.position?.tileY ?? 0;

  const statusRows = 2;
  const mapRows = rows - statusRows;

  const panelWidth = state.panelMode !== 'none' ? 42 : 0;
  const mapCols = cols - panelWidth;

  const halfW = Math.floor(mapCols / 2);
  const halfH = Math.floor(mapRows / 2);

  // Build entity position lookup
  const entityAtTile = new Map<number, { bp: number; effects: number; dead: boolean }>();
  for (const [, comp] of state.entityMap) {
    if (comp.position && comp.blueprint !== undefined) {
      const bpId = getBpId(comp.blueprint);
      if (bpId === undefined) continue;
      const effects = getEffects(comp.statusEffects);
      const actionType = getActionType(comp.currentAction);
      const dead = actionType === ActionType.Dead;
      entityAtTile.set(comp.position.tileY * MAP_SIZE + comp.position.tileX, { bp: bpId, effects, dead });
    }
  }

  // Recent chat messages (last 5 seconds, up to 3)
  const now = Date.now();
  const recentChat = state.chatLog
    .filter(c => now - c.time < 5000)
    .slice(-3);

  let out = '\x1b[H';

  for (let vy = 0; vy < mapRows; vy++) {
    const wy = playerY - halfH + vy;
    let line = '';

    for (let vx = 0; vx < mapCols; vx++) {
      const wx = playerX - halfW + vx;
      const dx = vx - halfW;
      const dy = vy - halfH;
      const isCursor = state.panelMode === 'none' && dx === state.cursorDX && dy === state.cursorDY;

      let ch: string;
      if (wx < 0 || wx >= MAP_SIZE || wy < 0 || wy >= MAP_SIZE ||
          Math.abs(wx - playerX) > INTEREST_RANGE || Math.abs(wy - playerY) > INTEREST_RANGE) {
        ch = ' ';
      } else {
        const gi = wy * MAP_SIZE + wx;
        const t = state.terrainGrid[gi] as Terrain;
        const b = state.buildingsGrid[gi] as Building;
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

      if (state.panelMode === 'debug') {
        const dbgIdx = state.debugLog.length - mapRows + vy;
        panelLine = dbgIdx >= 0 && dbgIdx < state.debugLog.length ? state.debugLog[dbgIdx] : '';
      } else if (state.panelMode === 'inventory') {
        panelLine = renderInventoryLine(vy, mapRows, pw);
      } else if (state.panelMode === 'crafting') {
        panelLine = renderCraftingLine(vy, mapRows, pw);
      } else if (state.panelMode === 'container') {
        panelLine = renderContainerLine(vy, mapRows, pw);
      } else if (state.panelMode === 'dialogue') {
        panelLine = renderDialogueLine(vy, mapRows, pw);
      }

      line += panelLine.slice(0, pw).padEnd(pw);
    }

    // Overlay chat messages on the bottom rows of the map area
    const chatRowOffset = mapRows - recentChat.length;
    if (vy >= chatRowOffset && vy < mapRows) {
      const chatIdx = vy - chatRowOffset;
      if (chatIdx < recentChat.length) {
        const c = recentChat[chatIdx];
        const senderComp = state.entityMap.get(c.senderEid);
        const senderBpId = getBpId(senderComp?.blueprint);
        const senderName = senderBpId !== undefined ? (getBlueprint(senderBpId)?.name ?? `Player#${c.senderEid}`) : `Player#${c.senderEid}`;
        const chatText = `${senderName}: ${c.message}`;
        line = `\x1b[93m${chatText.slice(0, mapCols).padEnd(mapCols)}\x1b[0m` + line.slice(mapCols);
      }
    }

    out += line + '\n';
  }

  // Status bar
  const cursorWorldX = playerX + state.cursorDX;
  const cursorWorldY = playerY + state.cursorDY;
  const wt = state.inventory.reduce((s, i) => s + (getBlueprint(i.blueprintId)?.weight ?? 0) * i.quantity, 0);

  const cursorCtx = buildCursorContext(playerX, playerY, state.cursorDX, state.cursorDY);
  const cursorAction = cursorCtx ? resolveAction(cursorCtx) : null;
  const actionLabel = describeAction(cursorAction, cursorCtx ?? undefined);

  // Health display
  const hp = getHp(myEntity?.health);
  const hpStr = hp ? `HP:${hp.currentHp}/${hp.maxHp}` : 'HP:?';

  // Activity status
  const actionType = getActionType(myEntity?.currentAction);
  const isCurrentlyHarvesting = actionType === ActionType.Harvesting;
  const isCurrentlyAttacking = actionType === ActionType.Attacking;

  let activityStatus = '';
  if (state.isDead) {
    const elapsed = (Date.now() - state.deathTime) / 1000;
    const remaining = Math.max(0, Math.ceil(5 - elapsed));
    activityStatus = ` | DEAD - Respawning in ${remaining}s...`;
  } else if (state.harvestCount > 0) {
    activityStatus = ` | +${state.harvestCount} ${state.harvestItemName}`;
  } else if (actionType === ActionType.Consuming) {
    activityStatus = ' | Eating...';
  } else if (isCurrentlyHarvesting) {
    activityStatus = ' | Harvesting...';
  } else if (isCurrentlyAttacking && myEntity?.currentAction && 'targetEntity' in myEntity.currentAction) {
    const targetEid = myEntity.currentAction.targetEntity!;
    const targetComp = state.entityMap.get(targetEid);
    const targetBpId = getBpId(targetComp?.blueprint);
    const targetBp = targetBpId !== undefined ? getBlueprint(targetBpId) : undefined;
    const targetHp = getHp(targetComp?.health);
    const thpStr = targetHp ? `${targetHp.currentHp}/${targetHp.maxHp}` : '';
    activityStatus = ` | Attacking ${targetBp?.name ?? '?'} ${thpStr}`;
  }

  const status1 = state.chatMode
    ? ` Chat: ${state.chatInput}_`
    : ` ${hpStr} (${playerX},${playerY}) Cursor(${cursorWorldX},${cursorWorldY}) E:${state.entityMap.size} T:${state.lastTick} W:${wt}/50${activityStatus}`;
  const keys = state.chatMode
    ? ' [enter]send [esc]cancel'
    : state.panelMode === 'none'
    ? ` [arrows]move [enter]${actionLabel} [u]se [t]alk [i]nv [d]ebug [q]uit`
    : state.panelMode === 'inventory'
    ? ' [↑↓]select [e]quip [u]se [g]drop [c]raft [i]close'
    : state.panelMode === 'crafting'
    ? ' [↑↓]select [enter]craft [c]back [i]close'
    : state.panelMode === 'container'
    ? ' [↑↓]select [tab]side [enter]transfer [esc]close'
    : state.panelMode === 'dialogue'
    ? ' [1-9]select [esc]close'
    : ' [d]close [q]uit';

  out += `\x1b[7m${status1.padEnd(cols)}\x1b[0m\n`;
  out += `\x1b[7m${keys.padEnd(cols)}\x1b[0m`;

  process.stdout.write(out);
}
