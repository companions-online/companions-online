import { ClientOpcode, ServerOpcode, DeltaSectionTag, TileFieldBit, WireEventType } from './opcodes.js';
import { ComponentBit } from '../components.js';
import { ActionType, ClientAction } from '../actions.js';
import type { MetaKey } from '../entity-meta.js';
import type {
  PositionData, DirectionData, NextWaypointData,
  CurrentActionData, HealthData, BlueprintData, StatusEffectsData,
} from '../components.js';

// --- Buffer helpers ---

const INITIAL_SIZE = 256;

export class BufferWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private pos = 0;

  constructor(size = INITIAL_SIZE) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
  }

  private ensure(bytes: number) {
    if (this.pos + bytes <= this.buf.byteLength) return;
    let newSize = this.buf.byteLength * 2;
    while (newSize < this.pos + bytes) newSize *= 2;
    const next = new ArrayBuffer(newSize);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(this.buf);
  }

  writeU8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.pos++, v);
  }

  writeU16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  writeU32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  getBuffer(): ArrayBuffer {
    return this.buf.slice(0, this.pos);
  }
}

export class BufferReader {
  private view: DataView;
  private pos = 0;

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }

  readU8(): number {
    return this.view.getUint8(this.pos++);
  }

  readU16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }
}

// --- Decoded types ---

export interface EntityComponents {
  position?: PositionData;
  direction?: DirectionData;
  nextWaypoint?: NextWaypointData;
  currentAction?: CurrentActionData;
  health?: HealthData;
  blueprint?: BlueprintData;
  statusEffects?: StatusEffectsData;
}

export interface DecodedEntityUpdate {
  entityId: number;
  components: EntityComponents;
}

export interface DecodedTileUpdate {
  tileX: number;
  tileY: number;
  terrain?: number;
  building?: number;
  buildingMeta?: number;
}

export interface DecodedEnvironment {
  gameMinute: number;
  weather: number;
}

export interface DecodedWorldDelta {
  tick: number;
  entityUpdates: DecodedEntityUpdate[];
  entityRemovals: number[];
  tileUpdates: DecodedTileUpdate[];
  environment?: DecodedEnvironment;
}

export interface DecodedEntityFullState {
  entityId: number;
  components: EntityComponents;
  speed?: number;
}

export interface DecodedChunk {
  chunkX: number;
  chunkY: number;
  terrain: Uint8Array;
  buildings: Uint8Array;
  buildingMeta: Uint8Array;
}

export interface ActionMoveToPayload { tileX: number; tileY: number }
export interface ActionInteractPayload { entityId: number }
export interface ActionBuildPayload { buildingType: number; tileX: number; tileY: number }

export interface DecodedActionCancel { action: number; }
export interface DecodedActionMoveTo { action: number; tileX: number; tileY: number; }
export interface DecodedActionInteract { action: number; entityId: number; }
export interface DecodedActionBuild { action: number; buildingType: number; tileX: number; tileY: number; }
export interface DecodedActionPickup { action: number; entityId: number; }
export interface DecodedActionEquip { action: number; itemId: number; }
export interface DecodedActionUnequip { action: number; slot: number; }
export interface DecodedActionDrop { action: number; itemId: number; }
export interface DecodedActionCraft { action: number; recipeId: number; }
export interface DecodedActionHarvest { action: number; tileX: number; tileY: number; }
export interface DecodedActionUseItemAt { action: number; itemId: number; tileX: number; tileY: number; }
export interface DecodedActionAttack { action: number; entityId: number; }
export interface DecodedActionTransfer { action: number; itemId: number; containerId: number; direction: number; }
export interface DecodedActionDialogueSelect { action: number; npcEntityId: number; optionId: number; }
export interface DecodedActionTrade { action: number; npcEntityId: number; tradeId: number; }
export interface DecodedActionUseConsumable { action: number; itemId: number; }
export interface DecodedActionSay { action: number; message: string; }
export interface DecodedActionServerCommand { action: number; command: string; parameter: string; }

export type DecodedAction =
  | DecodedActionCancel | DecodedActionMoveTo | DecodedActionInteract | DecodedActionBuild
  | DecodedActionPickup | DecodedActionEquip | DecodedActionUnequip | DecodedActionDrop | DecodedActionCraft
  | DecodedActionHarvest | DecodedActionUseItemAt | DecodedActionAttack
  | DecodedActionTransfer | DecodedActionDialogueSelect | DecodedActionTrade
  | DecodedActionUseConsumable | DecodedActionSay | DecodedActionServerCommand;

export interface SyncedInventoryItem {
  itemId: number;
  blueprintId: number;
  quantity: number;
  equippedSlot: number;
}

// --- Component encode/decode ---

function encodeComponents(w: BufferWriter, components: EntityComponents): number {
  let bitmask = 0;

  // Build bitmask first, then write in bit order
  if (components.position !== undefined) bitmask |= (1 << ComponentBit.Position);
  if (components.direction !== undefined) bitmask |= (1 << ComponentBit.Direction);
  if (components.nextWaypoint !== undefined) bitmask |= (1 << ComponentBit.NextWaypoint);
  if (components.currentAction !== undefined) bitmask |= (1 << ComponentBit.CurrentAction);
  if (components.health !== undefined) bitmask |= (1 << ComponentBit.Health);
  if (components.blueprint !== undefined) bitmask |= (1 << ComponentBit.Blueprint);
  if (components.statusEffects !== undefined) bitmask |= (1 << ComponentBit.StatusEffects);

  w.writeU8(bitmask);

  if (components.position !== undefined) {
    w.writeU16(components.position.tileX);
    w.writeU16(components.position.tileY);
  }
  if (components.direction !== undefined) {
    w.writeU8(components.direction.dir);
  }
  if (components.nextWaypoint !== undefined) {
    w.writeU16(components.nextWaypoint.tileX);
    w.writeU16(components.nextWaypoint.tileY);
  }
  if (components.currentAction !== undefined) {
    encodeCurrentAction(w, components.currentAction);
  }
  if (components.health !== undefined) {
    w.writeU16(components.health.currentHp);
    w.writeU16(components.health.maxHp);
  }
  if (components.blueprint !== undefined) {
    w.writeU16(components.blueprint.blueprintId);
    w.writeU8(components.blueprint.variant);
  }
  if (components.statusEffects !== undefined) {
    w.writeU16(components.statusEffects.effects);
  }

  return bitmask;
}

function encodeCurrentAction(w: BufferWriter, action: CurrentActionData) {
  w.writeU8(action.actionType);
  switch (action.actionType) {
    case ActionType.Interacting:
    case ActionType.Harvesting:
    case ActionType.Attacking:
      w.writeU16(action.targetEntity!);
      break;
    case ActionType.Building:
      w.writeU16(action.targetTileX!);
      w.writeU16(action.targetTileY!);
      break;
    // Idle, Walking, Dead: no payload
  }
}

function decodeComponents(r: BufferReader, bitmask: number): EntityComponents {
  const out: EntityComponents = {};

  if (bitmask & (1 << ComponentBit.Position)) {
    out.position = { tileX: r.readU16(), tileY: r.readU16() };
  }
  if (bitmask & (1 << ComponentBit.Direction)) {
    out.direction = { dir: r.readU8() };
  }
  if (bitmask & (1 << ComponentBit.NextWaypoint)) {
    out.nextWaypoint = { tileX: r.readU16(), tileY: r.readU16() };
  }
  if (bitmask & (1 << ComponentBit.CurrentAction)) {
    out.currentAction = decodeCurrentAction(r);
  }
  if (bitmask & (1 << ComponentBit.Health)) {
    out.health = { currentHp: r.readU16(), maxHp: r.readU16() };
  }
  if (bitmask & (1 << ComponentBit.Blueprint)) {
    out.blueprint = { blueprintId: r.readU16(), variant: r.readU8() };
  }
  if (bitmask & (1 << ComponentBit.StatusEffects)) {
    out.statusEffects = { effects: r.readU16() };
  }

  return out;
}

function decodeCurrentAction(r: BufferReader): CurrentActionData {
  const actionType: ActionType = r.readU8();
  switch (actionType) {
    case ActionType.Interacting:
    case ActionType.Harvesting:
    case ActionType.Attacking:
      return { actionType, targetEntity: r.readU16() };
    case ActionType.Building:
      return { actionType, targetTileX: r.readU16(), targetTileY: r.readU16() };
    default:
      return { actionType };
  }
}

// --- RLE ---

export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let count = 1;
    while (i + count < data.length && data[i + count] === val && count < 255) {
      count++;
    }
    out.push(count, val);
    i += count;
  }
  out.push(0); // terminator
  return new Uint8Array(out);
}

export function rleDecode(r: BufferReader): Uint8Array {
  const out = new Uint8Array(256);
  let pos = 0;
  while (true) {
    const count = r.readU8();
    if (count === 0) break;
    const val = r.readU8();
    for (let i = 0; i < count; i++) {
      out[pos++] = val;
    }
  }
  return out;
}

// --- Client → Server encoders ---

export function encodeAction(action: DecodedAction): ArrayBuffer {
  const w = new BufferWriter(8);
  w.writeU8(ClientOpcode.Action);
  w.writeU8(action.action);
  if (action.action === ClientAction.MoveTo) {
    const a = action as DecodedActionMoveTo;
    w.writeU16(a.tileX);
    w.writeU16(a.tileY);
  } else if (action.action === ClientAction.Interact) {
    const a = action as DecodedActionInteract;
    w.writeU16(a.entityId);
  } else if (action.action === ClientAction.Build) {
    const a = action as DecodedActionBuild;
    w.writeU8(a.buildingType);
    w.writeU16(a.tileX);
    w.writeU16(a.tileY);
  } else if (action.action === ClientAction.Pickup) {
    w.writeU16((action as DecodedActionPickup).entityId);
  } else if (action.action === ClientAction.Equip) {
    w.writeU16((action as DecodedActionEquip).itemId);
  } else if (action.action === ClientAction.Unequip) {
    w.writeU8((action as DecodedActionUnequip).slot);
  } else if (action.action === ClientAction.Drop) {
    w.writeU16((action as DecodedActionDrop).itemId);
  } else if (action.action === ClientAction.Craft) {
    w.writeU16((action as DecodedActionCraft).recipeId);
  } else if (action.action === ClientAction.Harvest) {
    const a = action as DecodedActionHarvest;
    w.writeU16(a.tileX);
    w.writeU16(a.tileY);
  } else if (action.action === ClientAction.UseItemAt) {
    const a = action as DecodedActionUseItemAt;
    w.writeU16(a.itemId);
    w.writeU16(a.tileX);
    w.writeU16(a.tileY);
  } else if (action.action === ClientAction.Attack) {
    w.writeU16((action as DecodedActionAttack).entityId);
  } else if (action.action === ClientAction.Transfer) {
    const a = action as DecodedActionTransfer;
    w.writeU16(a.itemId);
    w.writeU16(a.containerId);
    w.writeU8(a.direction);
  } else if (action.action === ClientAction.DialogueSelect) {
    const a = action as DecodedActionDialogueSelect;
    w.writeU16(a.npcEntityId);
    w.writeU8(a.optionId);
  } else if (action.action === ClientAction.Trade) {
    const a = action as DecodedActionTrade;
    w.writeU16(a.npcEntityId);
    w.writeU8(a.tradeId);
  } else if (action.action === ClientAction.UseConsumable) {
    w.writeU16((action as DecodedActionUseConsumable).itemId);
  } else if (action.action === ClientAction.Say) {
    const encoded = new TextEncoder().encode((action as DecodedActionSay).message);
    w.writeU16(encoded.byteLength);
    for (let i = 0; i < encoded.byteLength; i++) w.writeU8(encoded[i]);
  } else if (action.action === ClientAction.ServerCommand) {
    const a = action as DecodedActionServerCommand;
    const cmd = new TextEncoder().encode(a.command);
    w.writeU8(cmd.byteLength);
    for (let i = 0; i < cmd.byteLength; i++) w.writeU8(cmd[i]);
    const param = new TextEncoder().encode(a.parameter);
    w.writeU16(param.byteLength);
    for (let i = 0; i < param.byteLength; i++) w.writeU8(param[i]);
  }
  return w.getBuffer();
}

export function encodePing(clientTime: number): ArrayBuffer {
  const w = new BufferWriter(5);
  w.writeU8(ClientOpcode.Ping);
  w.writeU32(clientTime);
  return w.getBuffer();
}

// --- Server → Client encoders ---

export function encodePong(clientTime: number): ArrayBuffer {
  const w = new BufferWriter(5);
  w.writeU8(ServerOpcode.Pong);
  w.writeU32(clientTime);
  return w.getBuffer();
}

export function encodeWelcome(entityId: number, seed: number): ArrayBuffer {
  const w = new BufferWriter(7);
  w.writeU8(ServerOpcode.Welcome);
  w.writeU16(entityId);
  w.writeU32(seed);
  return w.getBuffer();
}

function writeItems(w: BufferWriter, items: SyncedInventoryItem[]): void {
  w.writeU8(items.length);
  for (const item of items) {
    w.writeU16(item.itemId);
    w.writeU16(item.blueprintId);
    w.writeU8(item.quantity);
    w.writeU8(item.equippedSlot);
  }
}

function readItems(r: BufferReader, count: number): SyncedInventoryItem[] {
  const items: SyncedInventoryItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ itemId: r.readU16(), blueprintId: r.readU16(), quantity: r.readU8(), equippedSlot: r.readU8() });
  }
  return items;
}

export function encodeInventorySync(items: SyncedInventoryItem[]): ArrayBuffer {
  const w = new BufferWriter(2 + items.length * 6);
  w.writeU8(ServerOpcode.InventorySync);
  writeItems(w, items);
  return w.getBuffer();
}

export function encodeContainerOpen(containerEntityId: number, items: SyncedInventoryItem[]): ArrayBuffer {
  const w = new BufferWriter(4 + items.length * 6);
  w.writeU8(ServerOpcode.ContainerOpen);
  w.writeU16(containerEntityId);
  writeItems(w, items);
  return w.getBuffer();
}

export function encodeDialogueOpen(npcEntityId: number, dialogueJson: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(dialogueJson);
  const w = new BufferWriter(3 + 2 + encoded.byteLength);
  w.writeU8(ServerOpcode.DialogueOpen);
  w.writeU16(npcEntityId);
  w.writeU16(encoded.byteLength);
  for (let i = 0; i < encoded.byteLength; i++) w.writeU8(encoded[i]);
  return w.getBuffer();
}

export function encodeEnvironmentSync(
  gameMinute: number,
  weather: number,
  serverTick: number,
): ArrayBuffer {
  const w = new BufferWriter(8);
  w.writeU8(ServerOpcode.EnvironmentSync);
  w.writeU16(gameMinute);
  w.writeU8(weather);
  w.writeU32(serverTick);
  return w.getBuffer();
}

export function encodeChatMessage(senderEntityId: number, message: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(message);
  const w = new BufferWriter(3 + 2 + encoded.byteLength);
  w.writeU8(ServerOpcode.ChatMessage);
  w.writeU16(senderEntityId);
  w.writeU16(encoded.byteLength);
  for (let i = 0; i < encoded.byteLength; i++) w.writeU8(encoded[i]);
  return w.getBuffer();
}

export function encodeEntityMeta(entityId: number, key: MetaKey, value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const w = new BufferWriter(1 + 2 + 1 + 2 + encoded.byteLength);
  w.writeU8(ServerOpcode.EntityMeta);
  w.writeU16(entityId);
  w.writeU8(key);
  w.writeU16(encoded.byteLength);
  for (let i = 0; i < encoded.byteLength; i++) w.writeU8(encoded[i]);
  return w.getBuffer();
}

export function encodeWorldDelta(
  tick: number,
  entityUpdates: DecodedEntityUpdate[],
  entityRemovals: number[],
  tileUpdates: DecodedTileUpdate[],
  environment?: DecodedEnvironment,
): ArrayBuffer {
  const w = new BufferWriter();
  w.writeU8(ServerOpcode.WorldDelta);
  w.writeU16(tick);

  if (environment !== undefined) {
    w.writeU8(DeltaSectionTag.Environment);
    w.writeU16(environment.gameMinute);
    w.writeU8(environment.weather);
  }

  if (entityUpdates.length > 0) {
    w.writeU8(DeltaSectionTag.EntityUpdates);
    w.writeU8(entityUpdates.length);
    for (const eu of entityUpdates) {
      w.writeU16(eu.entityId);
      encodeComponents(w, eu.components);
    }
  }

  if (entityRemovals.length > 0) {
    w.writeU8(DeltaSectionTag.EntityRemovals);
    w.writeU8(entityRemovals.length);
    for (const id of entityRemovals) {
      w.writeU16(id);
    }
  }

  if (tileUpdates.length > 0) {
    w.writeU8(DeltaSectionTag.TileUpdates);
    w.writeU8(tileUpdates.length);
    for (const tu of tileUpdates) {
      w.writeU16(tu.tileX);
      w.writeU16(tu.tileY);
      let fieldMask = 0;
      if (tu.terrain !== undefined) fieldMask |= (1 << TileFieldBit.Terrain);
      if (tu.building !== undefined) fieldMask |= (1 << TileFieldBit.Building);
      if (tu.buildingMeta !== undefined) fieldMask |= (1 << TileFieldBit.BuildingMeta);
      w.writeU8(fieldMask);
      if (tu.terrain !== undefined) w.writeU8(tu.terrain);
      if (tu.building !== undefined) w.writeU8(tu.building);
      if (tu.buildingMeta !== undefined) w.writeU8(tu.buildingMeta);
    }
  }

  w.writeU8(DeltaSectionTag.End);
  return w.getBuffer();
}

export function encodeEntityFullState(
  entityId: number,
  components: EntityComponents,
  speed?: number,
): ArrayBuffer {
  const w = new BufferWriter();
  w.writeU8(ServerOpcode.EntityFullState);
  w.writeU16(entityId);
  encodeComponents(w, components);
  if (speed !== undefined) {
    w.writeU8(speed);
  }
  return w.getBuffer();
}

export function encodeChunk(
  chunkX: number,
  chunkY: number,
  terrain: Uint8Array,
  buildings: Uint8Array,
  buildingMeta: Uint8Array,
): ArrayBuffer {
  const w = new BufferWriter();
  w.writeU8(ServerOpcode.Chunk);
  w.writeU8(chunkX);
  w.writeU8(chunkY);

  const rleT = rleEncode(terrain);
  const rleB = rleEncode(buildings);
  const rleM = rleEncode(buildingMeta);

  for (let i = 0; i < rleT.length; i++) w.writeU8(rleT[i]);
  for (let i = 0; i < rleB.length; i++) w.writeU8(rleB[i]);
  for (let i = 0; i < rleM.length; i++) w.writeU8(rleM[i]);

  return w.getBuffer();
}

export function encodeGameEvents(tick: number, events: WireEvent[]): ArrayBuffer {
  const w = new BufferWriter();
  w.writeU8(ServerOpcode.GameEvents);
  w.writeU32(tick);
  w.writeU8(events.length);
  for (const ev of events) {
    w.writeU8(ev.type);
    switch (ev.type) {
      case WireEventType.CombatHitDealt:
        w.writeU16(ev.attackerId);
        w.writeU16(ev.targetId);
        w.writeU16(ev.damage);
        w.writeU16(ev.targetHp);
        w.writeU16(ev.targetMaxHp);
        break;
      case WireEventType.HarvestYield:
        w.writeU16(ev.harvesterId);
        w.writeU16(ev.targetId);
        w.writeU16(ev.yieldBlueprintId);
        break;
      case WireEventType.CraftComplete:
        w.writeU16(ev.crafterId);
        w.writeU16(ev.blueprintId);
        w.writeU16(ev.quantity);
        break;
      case WireEventType.EntityDied:
        w.writeU16(ev.entityId);
        w.writeU16(ev.killerId);
        w.writeU16(ev.tileX);
        w.writeU16(ev.tileY);
        break;
    }
  }
  return w.getBuffer();
}

function decodeGameEvents(r: BufferReader): { tick: number; events: WireEvent[] } {
  const tick = r.readU32();
  const count = r.readU8();
  const events: WireEvent[] = [];
  for (let i = 0; i < count; i++) {
    const type: WireEventType = r.readU8();
    switch (type) {
      case WireEventType.CombatHitDealt:
        events.push({
          type,
          attackerId: r.readU16(),
          targetId: r.readU16(),
          damage: r.readU16(),
          targetHp: r.readU16(),
          targetMaxHp: r.readU16(),
        });
        break;
      case WireEventType.HarvestYield:
        events.push({
          type,
          harvesterId: r.readU16(),
          targetId: r.readU16(),
          yieldBlueprintId: r.readU16(),
        });
        break;
      case WireEventType.CraftComplete:
        events.push({
          type,
          crafterId: r.readU16(),
          blueprintId: r.readU16(),
          quantity: r.readU16(),
        });
        break;
      case WireEventType.EntityDied:
        events.push({
          type,
          entityId: r.readU16(),
          killerId: r.readU16(),
          tileX: r.readU16(),
          tileY: r.readU16(),
        });
        break;
      default:
        throw new Error(`Unknown wire event type: 0x${(type as number).toString(16)}`);
    }
  }
  return { tick, events };
}

// --- Decoders ---

export type DecodedServerMessage =
  | { type: 'welcome'; entityId: number; seed: number }
  | { type: 'pong'; clientTime: number }
  | { type: 'worldDelta'; data: DecodedWorldDelta }
  | { type: 'entityFullState'; data: DecodedEntityFullState }
  | { type: 'chunk'; data: DecodedChunk }
  | { type: 'inventorySync'; items: SyncedInventoryItem[] }
  | { type: 'containerOpen'; containerEntityId: number; items: SyncedInventoryItem[] }
  | { type: 'dialogueOpen'; npcEntityId: number; dialogue: unknown }
  | { type: 'chatMessage'; senderEntityId: number; message: string }
  | { type: 'environmentSync'; gameMinute: number; weather: number; serverTick: number }
  | { type: 'entityMeta'; entityId: number; key: MetaKey; value: string }
  | { type: 'gameEvents'; tick: number; events: WireEvent[] };

// --- Game events (notification channel) ---
//
// Discriminated union of per-type payloads. Numeric type tag matches
// WireEventType; encoded inside a GameEvents batch. Payloads carry entity
// ids only (no strings) — the client already has entity context.

export type WireEvent =
  | {
      type: WireEventType.CombatHitDealt;
      attackerId: number;
      targetId: number;
      damage: number;
      targetHp: number;
      targetMaxHp: number;
    }
  | {
      type: WireEventType.HarvestYield;
      harvesterId: number;
      /** 0xFFFF when the yield had no specific target entity (e.g. tile-based harvest) */
      targetId: number;
      yieldBlueprintId: number;
    }
  | {
      type: WireEventType.CraftComplete;
      crafterId: number;
      blueprintId: number;
      quantity: number;
    }
  | {
      type: WireEventType.EntityDied;
      entityId: number;
      killerId: number;
      tileX: number;
      tileY: number;
    };

export type DecodedClientMessage =
  | { type: 'action'; data: DecodedAction }
  | { type: 'ping'; clientTime: number };

export function decodeServerMessage(buf: ArrayBuffer): DecodedServerMessage {
  const r = new BufferReader(buf);
  const opcode = r.readU8();

  switch (opcode) {
    case ServerOpcode.Pong:
      return { type: 'pong', clientTime: r.readU32() };

    case ServerOpcode.WorldDelta:
      return { type: 'worldDelta', data: decodeWorldDelta(r) };

    case ServerOpcode.EntityFullState:
      return { type: 'entityFullState', data: decodeEntityFullState(r) };

    case ServerOpcode.Chunk:
      return { type: 'chunk', data: decodeChunk(r) };

    case ServerOpcode.Welcome:
      return { type: 'welcome', entityId: r.readU16(), seed: r.readU32() };

    case ServerOpcode.InventorySync:
      return { type: 'inventorySync', items: readItems(r, r.readU8()) };

    case ServerOpcode.DialogueOpen: {
      const npcEntityId = r.readU16();
      const jsonLen = r.readU16();
      const jsonBytes = new Uint8Array(jsonLen);
      for (let i = 0; i < jsonLen; i++) jsonBytes[i] = r.readU8();
      const dialogueJson = new TextDecoder().decode(jsonBytes);
      return { type: 'dialogueOpen', npcEntityId, dialogue: JSON.parse(dialogueJson) };
    }

    case ServerOpcode.ContainerOpen: {
      const containerEntityId = r.readU16();
      return { type: 'containerOpen', containerEntityId, items: readItems(r, r.readU8()) };
    }

    case ServerOpcode.ChatMessage: {
      const senderEntityId = r.readU16();
      const len = r.readU16();
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = r.readU8();
      return { type: 'chatMessage', senderEntityId, message: new TextDecoder().decode(bytes) };
    }
    case ServerOpcode.EnvironmentSync: {
      const gameMinute = r.readU16();
      const weather = r.readU8();
      const serverTick = r.readU32();
      return { type: 'environmentSync', gameMinute, weather, serverTick };
    }
    case ServerOpcode.EntityMeta: {
      const entityId = r.readU16();
      const key = r.readU8() as MetaKey;
      const len = r.readU16();
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = r.readU8();
      return { type: 'entityMeta', entityId, key, value: new TextDecoder().decode(bytes) };
    }

    case ServerOpcode.GameEvents: {
      const { tick, events } = decodeGameEvents(r);
      return { type: 'gameEvents', tick, events };
    }

    default:
      throw new Error(`Unknown server opcode: 0x${opcode.toString(16)}`);
  }
}

export function decodeClientMessage(buf: ArrayBuffer): DecodedClientMessage {
  const r = new BufferReader(buf);
  const opcode = r.readU8();

  switch (opcode) {
    case ClientOpcode.Action:
      return { type: 'action', data: decodeAction(r) };

    case ClientOpcode.Ping:
      return { type: 'ping', clientTime: r.readU32() };

    default:
      throw new Error(`Unknown client opcode: 0x${opcode.toString(16)}`);
  }
}

function decodeAction(r: BufferReader): DecodedAction {
  const action: ClientAction = r.readU8();
  switch (action) {
    case ClientAction.MoveTo:
      return { action, tileX: r.readU16(), tileY: r.readU16() };
    case ClientAction.Interact:
      return { action, entityId: r.readU16() };
    case ClientAction.Build:
      return { action, buildingType: r.readU8(), tileX: r.readU16(), tileY: r.readU16() };
    case ClientAction.Cancel:
      return { action };
    case ClientAction.Pickup:
      return { action, entityId: r.readU16() };
    case ClientAction.Equip:
      return { action, itemId: r.readU16() };
    case ClientAction.Unequip:
      return { action, slot: r.readU8() };
    case ClientAction.Drop:
      return { action, itemId: r.readU16() };
    case ClientAction.Craft:
      return { action, recipeId: r.readU16() };
    case ClientAction.Harvest:
      return { action, tileX: r.readU16(), tileY: r.readU16() };
    case ClientAction.UseItemAt:
      return { action, itemId: r.readU16(), tileX: r.readU16(), tileY: r.readU16() };
    case ClientAction.Attack:
      return { action, entityId: r.readU16() };
    case ClientAction.Transfer:
      return { action, itemId: r.readU16(), containerId: r.readU16(), direction: r.readU8() };
    case ClientAction.DialogueSelect:
      return { action, npcEntityId: r.readU16(), optionId: r.readU8() };
    case ClientAction.Trade:
      return { action, npcEntityId: r.readU16(), tradeId: r.readU8() };
    case ClientAction.UseConsumable:
      return { action, itemId: r.readU16() };
    case ClientAction.Say: {
      const len = r.readU16();
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = r.readU8();
      return { action, message: new TextDecoder().decode(bytes) };
    }
    case ClientAction.ServerCommand: {
      const cmdLen = r.readU8();
      const cmdBytes = new Uint8Array(cmdLen);
      for (let i = 0; i < cmdLen; i++) cmdBytes[i] = r.readU8();
      const paramLen = r.readU16();
      const paramBytes = new Uint8Array(paramLen);
      for (let i = 0; i < paramLen; i++) paramBytes[i] = r.readU8();
      return {
        action,
        command: new TextDecoder().decode(cmdBytes),
        parameter: new TextDecoder().decode(paramBytes),
      };
    }
    default:
      throw new Error(`Unknown client action: 0x${(action as number).toString(16)}`);
  }
}

function decodeWorldDelta(r: BufferReader): DecodedWorldDelta {
  const tick = r.readU16();
  const entityUpdates: DecodedEntityUpdate[] = [];
  const entityRemovals: number[] = [];
  const tileUpdates: DecodedTileUpdate[] = [];
  let environment: DecodedEnvironment | undefined;

  while (r.remaining > 0) {
    const tag: DeltaSectionTag = r.readU8();
    if (tag === DeltaSectionTag.End) break;

    switch (tag) {
      case DeltaSectionTag.EntityUpdates: {
        const count = r.readU8();
        for (let i = 0; i < count; i++) {
          const entityId = r.readU16();
          const bitmask = r.readU8();
          const components = decodeComponents(r, bitmask);
          entityUpdates.push({ entityId, components });
        }
        break;
      }
      case DeltaSectionTag.EntityRemovals: {
        const count = r.readU8();
        for (let i = 0; i < count; i++) {
          entityRemovals.push(r.readU16());
        }
        break;
      }
      case DeltaSectionTag.TileUpdates: {
        const count = r.readU8();
        for (let i = 0; i < count; i++) {
          const tileX = r.readU16();
          const tileY = r.readU16();
          const fieldMask = r.readU8();
          const tu: DecodedTileUpdate = { tileX, tileY };
          if (fieldMask & (1 << TileFieldBit.Terrain)) tu.terrain = r.readU8();
          if (fieldMask & (1 << TileFieldBit.Building)) tu.building = r.readU8();
          if (fieldMask & (1 << TileFieldBit.BuildingMeta)) tu.buildingMeta = r.readU8();
          tileUpdates.push(tu);
        }
        break;
      }
      case DeltaSectionTag.Environment: {
        environment = { gameMinute: r.readU16(), weather: r.readU8() };
        break;
      }
    }
  }

  return { tick, entityUpdates, entityRemovals, tileUpdates, environment };
}

function decodeEntityFullState(r: BufferReader): DecodedEntityFullState {
  const entityId = r.readU16();
  const bitmask = r.readU8();
  const components = decodeComponents(r, bitmask);
  const speed = r.remaining > 0 ? r.readU8() : undefined;
  return { entityId, components, speed };
}

function decodeChunk(r: BufferReader): DecodedChunk {
  const chunkX = r.readU8();
  const chunkY = r.readU8();
  const terrain = rleDecode(r);
  const buildings = rleDecode(r);
  const buildingMeta = rleDecode(r);
  return { chunkX, chunkY, terrain, buildings, buildingMeta };
}
