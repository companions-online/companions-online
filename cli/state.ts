import { MAP_SIZE } from '../shared/src/constants.js';
import type { EntityComponents, SyncedInventoryItem } from '../shared/src/protocol/codec.js';
import type { HealthData, BlueprintData, StatusEffectsData, CurrentActionData } from '../shared/src/components.js';

// --- Types ---

export type PanelMode = 'none' | 'debug' | 'inventory' | 'crafting' | 'container' | 'dialogue';

export interface DialogueData {
  greeting: string;
  options: {
    optionId: number;
    label: string;
    type: string;
    response?: string;
    trades?: {
      tradeId: number;
      givesBlueprint: number;
      givesQty: number;
      wantsBlueprint: number;
      wantsQty: number;
    }[];
  }[];
}

// --- Type helpers ---

/** Extract {currentHp, maxHp} from a health component, or undefined. */
export function getHp(comp: EntityComponents[keyof EntityComponents] | undefined): { currentHp: number; maxHp: number } | undefined {
  if (!comp || typeof comp !== 'object') return undefined;
  const h = comp as HealthData;
  if (typeof h.currentHp === 'number' && typeof h.maxHp === 'number') return h;
  return undefined;
}

/** Extract the numeric blueprintId from a blueprintId component, or undefined. */
export function getBpId(comp: EntityComponents[keyof EntityComponents] | undefined): number | undefined {
  if (comp === undefined) return undefined;
  if (typeof comp === 'number') return comp;
  const b = comp as BlueprintData;
  if (typeof b.blueprintId === 'number') return b.blueprintId;
  return undefined;
}

/** Extract the numeric effects bitmask from a statusEffects component, or 0. */
export function getEffects(comp: EntityComponents[keyof EntityComponents] | undefined): number {
  if (!comp) return 0;
  if (typeof comp === 'number') return comp;
  const s = comp as StatusEffectsData;
  if (typeof s.effects === 'number') return s.effects;
  return 0;
}

/** Extract the actionType from a currentAction component, or undefined. */
export function getActionType(comp: EntityComponents[keyof EntityComponents] | undefined): number | undefined {
  if (!comp) return undefined;
  if (typeof comp === 'number') return comp;
  const a = comp as CurrentActionData;
  if (typeof a.actionType === 'number') return a.actionType;
  return undefined;
}

// --- Mutable state singleton ---

export const state = {
  terrainGrid: new Uint8Array(MAP_SIZE * MAP_SIZE),
  buildingsGrid: new Uint8Array(MAP_SIZE * MAP_SIZE),
  entityMap: new Map<number, EntityComponents & { speed?: number }>(),

  myEntityId: 0,
  cursorDX: 0,
  cursorDY: 0,
  lastTick: 0,
  panelMode: 'none' as PanelMode,
  invCursor: 0,
  inventory: [] as SyncedInventoryItem[],
  prevInventory: [] as SyncedInventoryItem[],
  harvestCount: 0,
  harvestItemName: '',

  // Container
  containerEntityId: 0,
  containerItems: [] as SyncedInventoryItem[],
  containerCursor: 0,
  containerSide: 'chest' as 'player' | 'chest',

  // Dialogue
  isDead: false,
  deathTime: 0,
  dialogueNpcId: 0,
  dialogueData: null as DialogueData | null,

  // Chat
  chatLog: [] as { senderEid: number; message: string; time: number }[],
  chatInput: '' as string,
  chatMode: false as boolean,

  // Debug log
  debugLog: [] as string[],
};

const DEBUG_MAX = 200;

export function dbg(line: string) {
  state.debugLog.push(line);
  if (state.debugLog.length > DEBUG_MAX) state.debugLog.shift();
}
