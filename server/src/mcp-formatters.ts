import { ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { Terrain } from '@shared/terrain.js';
import { terrainChar, buildingChar, blueprintChar } from '@shared/ascii.js';
import { StatusEffect } from '@shared/status-effects.js';
import { getWeight, getEquipped, canCraft } from '@shared/inventory.js';
import { getAllRecipes } from '@shared/recipes.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameEvent } from './events.js';

// --- Helpers ---

const DIRECTION_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function directionLabel(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return '0';

  // Map to 8-dir: atan2 → 0-7 index
  const angle = Math.atan2(dy, dx); // radians, E=0, S=pi/2
  // Convert to compass: N=0, NE=1, E=2 ...
  // atan2 gives: E=0, N=-pi/2, W=pi, S=pi/2
  // We want: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
  const idx = Math.round(((angle + Math.PI / 2) / (Math.PI / 4)) + 8) % 8;
  return `${dist}${DIRECTION_NAMES[idx]}`;
}

const ACTION_NAMES: Record<number, string> = {
  [ActionType.Idle]: 'idle',
  [ActionType.Walking]: 'walking',
  [ActionType.Interacting]: 'interacting',
  [ActionType.Building]: 'building',
  [ActionType.Harvesting]: 'harvesting',
  [ActionType.Dead]: 'dead',
  [ActionType.PickingUp]: 'picking up',
  [ActionType.Crafting]: 'crafting',
  [ActionType.Attacking]: 'attacking',
  [ActionType.Consuming]: 'consuming',
};

const HOSTILE_BLUEPRINTS = new Set([BlueprintType.Wolf, BlueprintType.Bear, BlueprintType.Skeleton]);

function bpName(id: number): string {
  return getBlueprint(id)?.name ?? 'Unknown';
}

// --- formatSelf ---

export function formatSelf(conn: McpConnection): string {
  if (!conn.world) return '<self>\nunknown\n</self>';
  const w = conn.world;
  const eid = conn.entityId;

  const pos = w.entities.position.get(eid);
  const hp = w.entities.health.get(eid);
  const action = w.entities.currentAction.get(eid);
  const inv = w.inventoryMgr.get(eid);

  const posStr = pos ? `pos:(${pos.tileX},${pos.tileY})` : 'pos:?';
  const hpStr = hp ? `hp:${hp.currentHp}/${hp.maxHp}` : 'hp:?';
  const actionStr = action ? (ACTION_NAMES[action.actionType] ?? 'unknown') : 'idle';

  const hand = inv ? getEquipped(inv, 'hand') : undefined;
  const body = inv ? getEquipped(inv, 'body') : undefined;
  const head = inv ? getEquipped(inv, 'head') : undefined;
  const handStr = `hand:${hand ? bpName(hand.blueprintId) : 'empty'}`;
  const bodyStr = `body:${body ? bpName(body.blueprintId) : 'empty'}`;
  const headStr = `head:${head ? bpName(head.blueprintId) : 'empty'}`;

  const weight = inv ? getWeight(inv) : 0;
  const maxWeight = inv?.maxWeight ?? 0;
  const wtStr = `wt:${weight}/${maxWeight}`;

  return `<self>\n${posStr} ${hpStr} ${handStr} ${bodyStr} ${headStr} ${wtStr} ${actionStr}\n</self>`;
}

// --- formatMap ---

export function formatMap(conn: McpConnection): string {
  if (!conn.world) return '<map>\n</map>';
  const w = conn.world;
  const pos = w.entities.position.get(conn.entityId);
  if (!pos) return '<map>\n</map>';

  const r = conn.viewRange;
  const minX = pos.tileX - r;
  const maxX = pos.tileX + r;
  const minY = pos.tileY - r;
  const maxY = pos.tileY + r;

  // Build entity position lookup within viewport
  const entityAt = new Map<number, { blueprintId: number; effects?: number; isPlayer: boolean }>();
  for (const eid of w.entities.getAllEntities()) {
    if (eid === conn.entityId) continue;
    const epos = w.entities.position.get(eid);
    if (!epos) continue;
    if (epos.tileX < minX || epos.tileX > maxX || epos.tileY < minY || epos.tileY > maxY) continue;
    const bp = w.entities.blueprint.get(eid);
    if (!bp) continue;
    const se = w.entities.statusEffects.get(eid);
    const key = epos.tileY * 65536 + epos.tileX;
    const isPlayer = bp.blueprintId === BlueprintType.Player;
    entityAt.set(key, { blueprintId: bp.blueprintId, effects: se?.effects, isPlayer });
  }

  const lines: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      if (x === pos.tileX && y === pos.tileY) {
        row += '@';
        continue;
      }
      const inBounds = x >= 0 && x < w.map.width && y >= 0 && y < w.map.height;
      if (!inBounds) {
        row += '~'; // out of bounds = water
        continue;
      }
      const key = y * 65536 + x;
      const ent = entityAt.get(key);
      if (ent) {
        row += ent.isPlayer ? 'P' : blueprintChar(ent.blueprintId, ent.effects);
      } else {
        const terrain = w.map.getTerrain(x, y);
        const building = w.map.getBuilding(x, y);
        const bc = buildingChar(building);
        row += bc || terrainChar(terrain);
      }
    }
    lines.push(row);
  }

  lines.push('<legend>~ water . grass , dirt T tree ^ hill @ you W wolf d deer r rabbit P player # wall + door C chest F campfire * item</legend>');
  return `<map>\n${lines.join('\n')}\n</map>`;
}

// --- formatEntities ---

interface EntityInfo {
  eid: number;
  name: string;
  blueprintId: number;
  x: number;
  y: number;
  dist: number;
  dirLabel: string;
  hp?: { current: number; max: number };
  effects?: number;
  category: 'threat' | 'creature' | 'npc' | 'ground_item' | 'tree' | 'structure' | 'player';
  treeRemaining?: number;
}

function categorizeEntity(
  eid: number, conn: McpConnection,
  px: number, py: number,
): EntityInfo | null {
  const w = conn.world!;
  const epos = w.entities.position.get(eid);
  if (!epos) return null;
  const bp = w.entities.blueprint.get(eid);
  if (!bp) return null;

  const dist = Math.max(Math.abs(epos.tileX - px), Math.abs(epos.tileY - py));
  if (dist > conn.viewRange) return null;

  const bpDef = getBlueprint(bp.blueprintId);
  if (!bpDef) return null;

  const health = w.entities.health.get(eid);
  const effects = w.entities.statusEffects.get(eid);
  const dirLbl = directionLabel(px, py, epos.tileX, epos.tileY);

  const base = {
    eid, name: bpDef.name, blueprintId: bp.blueprintId,
    x: epos.tileX, y: epos.tileY, dist, dirLabel: dirLbl,
    hp: health ? { current: health.currentHp, max: health.maxHp } : undefined,
    effects: effects?.effects,
  };

  // Tree
  if (bp.blueprintId === BlueprintType.Tree) {
    const treeRes = (w as any).treeResources as Map<number, number> | undefined;
    const remaining = treeRes?.get(eid);
    return { ...base, category: 'tree', treeRemaining: remaining };
  }

  // NPC
  if (bpDef.category === 'npc') {
    return { ...base, category: 'npc' };
  }

  // Player
  if (bp.blueprintId === BlueprintType.Player) {
    return { ...base, category: 'player' };
  }

  // Ground item: resource/item/placeable without statusEffects
  if ((bpDef.category === 'resource' || bpDef.category === 'item' || bpDef.category === 'placeable') && !effects) {
    return { ...base, category: 'ground_item' };
  }

  // Structure: placeable with statusEffects
  if (bpDef.category === 'placeable' && effects) {
    return { ...base, category: 'structure' };
  }

  // Hostile creature
  if (bpDef.category === 'creature' && HOSTILE_BLUEPRINTS.has(bp.blueprintId)) {
    return { ...base, category: 'threat' };
  }

  // Other creature
  if (bpDef.category === 'creature') {
    return { ...base, category: 'creature' };
  }

  return null;
}

export function formatEntities(conn: McpConnection): string {
  if (!conn.world) return '<entities>\n</entities>';
  const pos = conn.world.entities.position.get(conn.entityId);
  if (!pos) return '<entities>\n</entities>';

  const threats: EntityInfo[] = [];
  const creatures: EntityInfo[] = [];
  const npcs: EntityInfo[] = [];
  const groundItems: EntityInfo[] = [];
  const trees: EntityInfo[] = [];
  const structures: EntityInfo[] = [];
  const players: EntityInfo[] = [];

  for (const eid of conn.world.entities.getAllEntities()) {
    if (eid === conn.entityId) continue;
    const info = categorizeEntity(eid, conn, pos.tileX, pos.tileY);
    if (!info) continue;
    switch (info.category) {
      case 'threat': threats.push(info); break;
      case 'creature': creatures.push(info); break;
      case 'npc': npcs.push(info); break;
      case 'ground_item': groundItems.push(info); break;
      case 'tree': trees.push(info); break;
      case 'structure': structures.push(info); break;
      case 'player': players.push(info); break;
    }
  }

  // Sort all by distance
  const byDist = (a: EntityInfo, b: EntityInfo) => a.dist - b.dist;
  threats.sort(byDist);
  creatures.sort(byDist);
  npcs.sort(byDist);
  groundItems.sort(byDist);
  trees.sort(byDist);
  structures.sort(byDist);
  players.sort(byDist);

  const lines: string[] = [];

  if (threats.length) {
    lines.push('-- threats --');
    for (const e of threats) {
      const hpStr = e.hp ? ` hp:${e.hp.current}/${e.hp.max}` : '';
      lines.push(`  ${e.name.toLowerCase()}#${e.eid} (${e.x},${e.y}) ${e.dirLabel}${hpStr} hostile`);
    }
  }

  if (creatures.length) {
    lines.push('-- creatures --');
    for (const e of creatures) {
      const hpStr = e.hp ? ` hp:${e.hp.current}/${e.hp.max}` : '';
      lines.push(`  ${e.name.toLowerCase()}#${e.eid} (${e.x},${e.y}) ${e.dirLabel}${hpStr}`);
    }
  }

  if (players.length) {
    lines.push('-- players --');
    for (const e of players) {
      const hpStr = e.hp ? ` hp:${e.hp.current}/${e.hp.max}` : '';
      lines.push(`  player#${e.eid} (${e.x},${e.y}) ${e.dirLabel}${hpStr}`);
    }
  }

  if (npcs.length) {
    lines.push('-- npcs --');
    for (const e of npcs) {
      lines.push(`  ${e.name}#${e.eid} (${e.x},${e.y}) ${e.dirLabel}`);
    }
  }

  if (groundItems.length) {
    lines.push('-- ground items --');
    for (const e of groundItems) {
      lines.push(`  ${e.name.toLowerCase()}#${e.eid} (${e.x},${e.y}) ${e.dirLabel}`);
    }
  }

  if (trees.length) {
    const shown = trees.slice(0, 3);
    const remaining = trees.length - shown.length;
    lines.push(`-- trees (${trees.length} in view) --`);
    for (const e of shown) {
      const resStr = e.treeRemaining !== undefined ? ` wood:${e.treeRemaining}/5` : '';
      lines.push(`  tree#${e.eid} (${e.x},${e.y}) ${e.dirLabel}${resStr}`);
    }
    if (remaining > 0) {
      const nearest = shown.length > 0 ? shown[0].dist : 0;
      lines.push(`  ...${remaining} more, nearest: ${nearest} tiles`);
    }
  }

  if (structures.length) {
    lines.push('-- structures --');
    for (const e of structures) {
      const doorState = e.blueprintId === BlueprintType.WoodenDoor && e.effects !== undefined
        ? ((e.effects & StatusEffect.Open) ? ' open' : ' closed') : '';
      lines.push(`  ${e.name.toLowerCase()}#${e.eid} (${e.x},${e.y}) ${e.dirLabel}${doorState}`);
    }
  }

  return `<entities>\n${lines.join('\n')}\n</entities>`;
}

// --- formatTerrain ---

export function formatTerrain(conn: McpConnection): string {
  if (!conn.world) return '<terrain>\n</terrain>';
  const pos = conn.world.entities.position.get(conn.entityId);
  if (!pos) return '<terrain>\n</terrain>';

  const r = conn.viewRange;
  const rock: string[] = [];
  const water: string[] = [];

  for (let y = pos.tileY - r; y <= pos.tileY + r; y++) {
    for (let x = pos.tileX - r; x <= pos.tileX + r; x++) {
      if (x < 0 || x >= conn.world.map.width || y < 0 || y >= conn.world.map.height) continue;
      const t = conn.world.map.getTerrain(x, y);
      const label = `(${x},${y}) ${directionLabel(pos.tileX, pos.tileY, x, y)}`;
      if (t === Terrain.Rock) rock.push(label);
      else if (t === Terrain.Water || t === Terrain.River) water.push(label);
    }
  }

  const lines: string[] = [];
  if (rock.length) {
    const shown = rock.slice(0, 3).join(', ');
    const more = rock.length > 3 ? `  +${rock.length - 3} more` : '';
    lines.push(`rock: ${shown}${more}`);
  }
  if (water.length) {
    const shown = water.slice(0, 3).join(', ');
    const more = water.length > 3 ? `  +${water.length - 3} more` : '';
    lines.push(`water: ${shown}${more}`);
  }

  return `<terrain>\n${lines.join('\n')}\n</terrain>`;
}

// --- formatEvents ---

function formatEventText(event: GameEvent, currentTick: number): string {
  const offset = currentTick - event.tick;
  const prefix = `[t-${offset}]`;
  const d = event.details as any;

  switch (event.type) {
    case 'combat_hit_received':
      return `${prefix}  ${d.attackerName}#${d.attackerEntityId} hit you for ${d.damage} dmg (${d.currentHp}/${d.maxHp} HP)`;
    case 'combat_hit_dealt':
      return `${prefix}  You hit ${d.targetName}#${d.targetEntityId} for ${d.damage} dmg (${d.targetCurrentHp}/${d.targetMaxHp} HP)`;
    case 'entity_died': {
      const dropStr = d.drops.length
        ? ' → dropped ' + d.drops.map((dr: any) => `${dr.quantity} ${dr.name}`).join(', ') + ` at (${d.tileX},${d.tileY})`
        : '';
      return `${prefix}  ${d.entityName}#${d.entityId} died${dropStr}`;
    }
    case 'player_died':
      return `${prefix}  You died. Respawning...`;
    case 'player_respawned':
      return `${prefix}  Respawned at (${d.tileX},${d.tileY}) hp:${d.currentHp}/${d.maxHp}`;
    case 'player_say':
      return `${prefix}  ${d.senderName}#${d.senderEntityId} said: "${d.message}"`;
    case 'action_interrupted':
      return `${prefix}  ${d.interruptedAction} interrupted: ${d.reason}`;
    case 'creature_aggro':
      return `${prefix}  ${d.creatureName}#${d.creatureEntityId} is targeting you`;
    case 'harvest_yield': {
      const remaining = d.remaining !== undefined ? ` (${d.remaining} remaining)` : '';
      const target = d.targetName ? ` from ${d.targetName}#${d.targetEntityId}` : '';
      return `${prefix}  +1 ${d.resourceName}${target}${remaining}`;
    }
    case 'resource_depleted':
      return `${prefix}  ${d.entityName}#${d.entityId} depleted`;
    case 'item_picked_up':
      return `${prefix}  Picked up ${d.itemName} ×${d.quantity}`;
    case 'craft_complete':
      return `${prefix}  Crafted ${d.itemName}`;
    case 'trade_complete': {
      const gaveStr = d.gaveQuantity > 0 ? `${d.gaveQuantity} ${d.gaveName} → ` : '';
      return `${prefix}  Traded with ${d.npcName}: ${gaveStr}${d.receivedQuantity} ${d.receivedName}`;
    }
    case 'item_cooked':
      return `${prefix}  Cooked ${d.inputName} → ${d.outputName}`;
    case 'consume_complete':
      return `${prefix}  Used ${d.itemName}: +${d.healAmount} HP (${d.currentHp}/${d.maxHp})`;
    case 'building_placed':
      return `${prefix}  Placed ${d.itemName} at (${d.tileX},${d.tileY})`;
    case 'creature_fleeing':
      return `${prefix}  ${d.creatureName}#${d.creatureEntityId} is fleeing`;
    case 'creature_died':
      return `${prefix}  ${d.entityName}#${d.entityId} killed by ${d.killerName}#${d.killerEntityId} at (${d.tileX},${d.tileY})`;
    default:
      return `${prefix}  (unknown event)`;
  }
}

export function formatEvents(conn: McpConnection): string {
  const currentTick = conn.world ? (conn.world as any).currentTick ?? 0 : 0;
  const events = conn.eventBuffer.flush();
  if (events.length === 0) return '<events>\n</events>';

  const lines = events.map(e => formatEventText(e, currentTick));
  return `<events>\n${lines.join('\n')}\n</events>`;
}

// --- formatInventory ---

export function formatInventory(conn: McpConnection): string {
  if (!conn.world) return '<inventory>\nempty\n</inventory>';
  const inv = conn.world.inventoryMgr.get(conn.entityId);
  if (!inv) return '<inventory>\nempty\n</inventory>';

  const lines: string[] = [];

  // Equipment slots
  const hand = getEquipped(inv, 'hand');
  const body = getEquipped(inv, 'body');
  const head = getEquipped(inv, 'head');
  lines.push(hand ? `[hand] #${hand.itemId} ${bpName(hand.blueprintId)}  wt:${(getBlueprint(hand.blueprintId)?.weight ?? 0) * hand.quantity}` : '[hand] empty');
  lines.push(body ? `[body] #${body.itemId} ${bpName(body.blueprintId)}  wt:${(getBlueprint(body.blueprintId)?.weight ?? 0) * body.quantity}` : '[body] empty');
  lines.push(head ? `[head] #${head.itemId} ${bpName(head.blueprintId)}  wt:${(getBlueprint(head.blueprintId)?.weight ?? 0) * head.quantity}` : '[head] empty');
  lines.push('---');

  // Bag items (non-equipped)
  for (const item of inv.items) {
    if (item.equippedSlot) continue;
    const wt = (getBlueprint(item.blueprintId)?.weight ?? 0) * item.quantity;
    lines.push(`#${item.itemId} ${bpName(item.blueprintId)} ×${item.quantity}  wt:${wt}`);
  }

  const weight = getWeight(inv);
  lines.push(`total: ${weight}/${inv.maxWeight}`);

  return `<inventory>\n${lines.join('\n')}\n</inventory>`;
}

// --- formatRecipes ---

export function formatRecipes(conn: McpConnection): string {
  if (!conn.world) return '<recipes>\n</recipes>';
  const inv = conn.world.inventoryMgr.get(conn.entityId);
  if (!inv) return '<recipes>\n</recipes>';

  const lines: string[] = [];
  for (const recipe of getAllRecipes()) {
    if (!canCraft(recipe, inv)) continue;
    const inputs = recipe.inputs.map(i => `${i.quantity} ${bpName(i.blueprintId)}`).join(' + ');
    const outBp = getBlueprint(recipe.output.blueprintId);
    const outWt = outBp?.weight ?? 0;
    lines.push(`(${recipe.id}) ${bpName(recipe.output.blueprintId)}: ${inputs} → ${recipe.output.quantity} ${bpName(recipe.output.blueprintId)}  (wt:${outWt})`);
  }

  if (lines.length === 0) lines.push('(none available)');
  return `<recipes>\n${lines.join('\n')}\n</recipes>`;
}

// --- formatContainer ---

export function formatContainer(conn: McpConnection): string {
  if (!conn.world || conn.containerEntityId === null) return '<container>\nnone open\n</container>';
  const containerEid = conn.containerEntityId;
  const inv = conn.world.inventoryMgr.get(containerEid);
  if (!inv) return '<container>\nempty\n</container>';

  const bp = conn.world.entities.blueprint.get(containerEid);
  const name = bp ? bpName(bp.blueprintId).toLowerCase() : 'container';

  const lines: string[] = [];
  for (const item of inv.items) {
    const wt = (getBlueprint(item.blueprintId)?.weight ?? 0) * item.quantity;
    lines.push(`#${item.itemId} ${bpName(item.blueprintId)} ×${item.quantity}  wt:${wt}`);
  }

  const weight = getWeight(inv);
  lines.push(`stored: ${weight}/${inv.maxWeight}`);

  return `<container entity="${name}#${containerEid}">\n${lines.join('\n')}\n</container>`;
}

// --- Envelope composers ---

export function formatActionResponse(conn: McpConnection, actionText: string): string {
  const tick = conn.world ? (conn.world as any).currentTick ?? 0 : 0;
  return [
    `<action tick="${tick}">\n${actionText}\n</action>`,
    formatSelf(conn),
    formatMap(conn),
    formatEntities(conn),
    formatTerrain(conn),
    formatEvents(conn),
  ].join('\n\n');
}

export function formatSurroundings(conn: McpConnection): string {
  return [
    formatSelf(conn),
    formatMap(conn),
    formatEntities(conn),
    formatTerrain(conn),
    formatEvents(conn),
  ].join('\n\n');
}
