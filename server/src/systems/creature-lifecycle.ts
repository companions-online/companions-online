// Time-of-day creature lifecycle: night skeleton spawning + sunrise decay.
// Runs from GameWorld.runTick's worldPulse phase, alongside resource respawns.

import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { MAP_SIZE, TICKS_PER_GAME_HOUR } from '@shared/constants.js';
import { gameHourFromTick } from '@shared/lighting.js';
import type { SystemState } from '../system-state.js';
import { initCritterForEntity } from './critter-ai.js';
import { spawnCreatureEntity } from '../entity-spawn.js';

export const SKELETON_NIGHT_SPAWN_PER_HOUR = 1;
export const SKELETON_MIN_PLAYER_DISTANCE = 10;
export const SKELETON_MAX_PLAYER_DISTANCE = 20;
export const SKELETON_SUN_DAMAGE = 4;
export const SKELETON_SUN_DAMAGE_TICKS = 25;

const SPAWN_ATTEMPTS = 30;

function rand(world: SystemState): number {
  world.respawnRng = (world.respawnRng * 1664525 + 1013904223) >>> 0;
  return (world.respawnRng >>> 0) / 0x100000000;
}

function isNight(hour: number): boolean {
  return hour < 5 || hour >= 20;
}

/** Chebyshev distance to the nearest player. Infinity if no players exist. */
function nearestPlayerDistance(tx: number, ty: number, world: SystemState): number {
  let nearest = Infinity;
  for (const [playerEid] of world.players) {
    const p = world.entities.position.get(playerEid);
    if (!p) continue;
    const d = Math.max(Math.abs(tx - p.tileX), Math.abs(ty - p.tileY));
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/** Any light-emitting entity whose radius (Chebyshev AABB, no shadowcast)
 *  covers the tile. */
function tileLitByEmitter(tx: number, ty: number, world: SystemState): boolean {
  for (const [eid, bp] of world.entities.blueprint) {
    const def = getBlueprint(bp.blueprintId);
    if (!def || !def.lightRadius || def.lightRadius <= 0) continue;
    const pos = world.entities.position.get(eid);
    if (!pos) continue;
    if (Math.max(Math.abs(tx - pos.tileX), Math.abs(ty - pos.tileY)) <= def.lightRadius) return true;
  }
  return false;
}

/** Roll a chance to spawn one skeleton at night in a dark, player-adjacent
 *  tile. Gated by time-of-day, player presence, and per-hour rate. */
export function runCreatureRespawns(world: SystemState): void {
  const hour = gameHourFromTick(world.effectiveTick);
  if (!isNight(hour)) return;
  if (world.players.size === 0) return;

  const perTickChance = SKELETON_NIGHT_SPAWN_PER_HOUR / TICKS_PER_GAME_HOUR;
  if (rand(world) >= perTickChance) return;

  // Materialize player list once for uniform random picking.
  const playerIds: number[] = [];
  for (const [eid] of world.players) playerIds.push(eid);

  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const anchor = playerIds[Math.floor(rand(world) * playerIds.length)];
    const anchorPos = world.entities.position.get(anchor);
    if (!anchorPos) continue;

    const angle = rand(world) * Math.PI * 2;
    const dist = SKELETON_MIN_PLAYER_DISTANCE
      + rand(world) * (SKELETON_MAX_PLAYER_DISTANCE - SKELETON_MIN_PLAYER_DISTANCE);
    const tx = Math.round(anchorPos.tileX + Math.cos(angle) * dist);
    const ty = Math.round(anchorPos.tileY + Math.sin(angle) * dist);

    if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
    if (!world.map.isWalkable(tx, ty)) continue;
    if (world.occupancy.isOccupied(tx, ty)) continue;

    // The anchor might be close enough, but the tile must respect MIN/MAX
    // against *all* players.
    const nearest = nearestPlayerDistance(tx, ty, world);
    if (nearest < SKELETON_MIN_PLAYER_DISTANCE) continue;
    if (nearest > SKELETON_MAX_PLAYER_DISTANCE) continue;

    if (tileLitByEmitter(tx, ty, world)) continue;

    const eid = spawnCreatureEntity(world, BlueprintType.Skeleton, tx, ty);
    initCritterForEntity(eid, world);
    return;
  }
}

export interface CreatureDeath {
  entityId: number;
  killerEntityId: number;
}

/** Apply sun damage to all living skeletons once every
 *  SKELETON_SUN_DAMAGE_TICKS during daylight (ambient above flat-night).
 *  Returns entities whose HP hit zero so the caller can route them through
 *  the normal death pipeline. */
export function runCreatureLifecycle(world: SystemState): CreatureDeath[] {
  const hour = gameHourFromTick(world.effectiveTick);
  if (isNight(hour)) return [];
  if (world.currentTick % SKELETON_SUN_DAMAGE_TICKS !== 0) return [];

  const deaths: CreatureDeath[] = [];
  for (const [eid, bp] of world.entities.blueprint) {
    if (bp.blueprintId !== BlueprintType.Skeleton) continue;
    const health = world.entities.health.get(eid);
    if (!health) continue;
    const next = Math.max(0, health.currentHp - SKELETON_SUN_DAMAGE);
    if (next === health.currentHp) continue;
    world.entities.health.set(eid, { currentHp: next, maxHp: health.maxHp });
    if (next <= 0) deaths.push({ entityId: eid, killerEntityId: 0 });
  }
  return deaths;
}
