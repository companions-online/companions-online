export { TICK_RATE, TICK_MS, MAP_SIZE, CHUNK_SIZE, VIEW_RANGE, INTEREST_RANGE, SPAWN_X, SPAWN_Y } from './constants.js';
export { Direction, DX, DY, isDiagonal } from './direction.js';
export { Terrain, Building, isWalkable } from './terrain.js';
export { ActionType, ClientAction } from './actions.js';
export { StatusEffect } from './status-effects.js';
export { ComponentBit, WAYPOINT_NONE } from './components.js';
export type { PositionData, DirectionData, NextWaypointData, CurrentActionData, HealthData, BlueprintIdData, StatusEffectsData } from './components.js';
export { BlueprintType, getBlueprint } from './blueprints.js';
export type { Blueprint } from './blueprints.js';
export { ClientOpcode, ServerOpcode, DeltaSectionTag, TileFieldBit } from './protocol/opcodes.js';
export {
  BufferWriter, BufferReader,
  rleEncode, rleDecode,
  encodeAction, encodePing, encodePong, encodeWelcome,
  encodeWorldDelta, encodeEntityFullState, encodeChunk,
  decodeServerMessage, decodeClientMessage,
} from './protocol/codec.js';
export type {
  EntityComponents,
  DecodedEntityUpdate, DecodedTileUpdate, DecodedWorldDelta,
  DecodedEntityFullState, DecodedChunk, DecodedAction,
  DecodedServerMessage, DecodedClientMessage,
} from './protocol/codec.js';
export { tileToScreen, screenToTile } from './coordinates.js';
export type { ScreenPoint, TilePoint } from './coordinates.js';
export { terrainChar, buildingChar, blueprintChar, tileChar } from './ascii.js';
export { PerlinNoise, WorldMap, generateWorld } from './world/index.js';
export type { WorldGenResult, EntitySpawn } from './world/index.js';
export { resolveAction } from './action-resolver.js';
export type { ActionContext } from './action-resolver.js';
