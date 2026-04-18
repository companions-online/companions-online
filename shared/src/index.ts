export { TICK_RATE, TICK_MS, MAP_SIZE, CHUNK_SIZE, VIEW_RANGE, INTEREST_RANGE, SPAWN_X, SPAWN_Y } from './constants.js';
export { Direction, DX, DY, isDiagonal } from './direction.js';
export { Terrain, Building, isWalkable } from './terrain.js';
export { ActionType, ClientAction } from './actions.js';
export { StatusEffect } from './status-effects.js';
export { MetaKey, metaKeyLabel } from './entity-meta.js';
export { ComponentBit, WAYPOINT_NONE } from './components.js';
export type { PositionData, DirectionData, NextWaypointData, CurrentActionData, HealthData, BlueprintData, StatusEffectsData } from './components.js';
export { BlueprintType, getBlueprint } from './blueprints.js';
export type { Blueprint, BlueprintCategory, EquipSlot } from './blueprints.js';
export { getRecipe, getAllRecipes } from './recipes.js';
export type { Recipe } from './recipes.js';
export { getWeight, findItem, getEquipped, hasItems, canCraft, equipSlotToNumber, numberToEquipSlot, EQUIP_SLOT_NONE, EQUIP_SLOT_HAND, EQUIP_SLOT_BODY, EQUIP_SLOT_HEAD } from './inventory.js';
export type { InventoryItem, Inventory } from './inventory.js';
export { ClientOpcode, ServerOpcode, DeltaSectionTag, TileFieldBit } from './protocol/opcodes.js';
export {
  BufferWriter, BufferReader,
  rleEncode, rleDecode,
  encodeAction, encodePing, encodePong, encodeWelcome, encodeInventorySync,
  encodeWorldDelta, encodeEntityFullState, encodeChunk, encodeEntityMeta,
  decodeServerMessage, decodeClientMessage,
} from './protocol/codec.js';
export type {
  EntityComponents,
  DecodedEntityUpdate, DecodedTileUpdate, DecodedWorldDelta,
  DecodedEntityFullState, DecodedChunk, DecodedAction,
  SyncedInventoryItem,
  DecodedActionPickup, DecodedActionEquip, DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft,
  DecodedActionHarvest, DecodedActionUseItemAt, DecodedActionAttack, DecodedActionServerCommand,
  DecodedServerMessage, DecodedClientMessage,
} from './protocol/codec.js';
export { tileToScreen, screenToTile } from './coordinates.js';
export type { ScreenPoint, TilePoint } from './coordinates.js';
export { terrainChar, buildingChar, blueprintChar, tileChar } from './ascii.js';
export { PerlinNoise, WorldMap, generateWorld } from './world/index.js';
export type { WorldGenResult, EntitySpawn } from './world/index.js';
export { resolveAction, describeAction } from './action-resolver.js';
export { getLootTable } from './loot-tables.js';
export type { LootDrop } from './loot-tables.js';
export type { ActionContext } from './action-resolver.js';
export { findPath } from './pathfinding.js';
export type { PathResult } from './pathfinding.js';
