import { type Direction } from './direction.js';
import { type ActionType } from './actions.js';

/** Bit index of each synced component in the entity delta bitmask */
export const enum ComponentBit {
  Position      = 0,
  Direction     = 1,
  NextWaypoint  = 2,
  CurrentAction = 3,
  Health        = 4,
  BlueprintId   = 5,
  StatusEffects = 6,
}

export const WAYPOINT_NONE = 0xFFFF;

// Wire data shapes for each synced component

export interface PositionData {
  tileX: number;  // uint16
  tileY: number;  // uint16
}

export interface DirectionData {
  dir: Direction;  // uint8 0-7
}

export interface NextWaypointData {
  tileX: number;  // uint16, WAYPOINT_NONE = stationary
  tileY: number;  // uint16
}

export interface CurrentActionData {
  actionType: ActionType;      // uint8
  targetEntity?: number;       // uint16, for Interacting/Harvesting
  targetTileX?: number;        // uint16, for Building
  targetTileY?: number;        // uint16, for Building
}

export interface HealthData {
  currentHp: number;  // uint16
  maxHp: number;      // uint16
}

export interface BlueprintIdData {
  blueprintId: number;  // uint16
}

export interface StatusEffectsData {
  effects: number;  // uint16 bitmask
}
