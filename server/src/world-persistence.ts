import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { generateWorld } from '@shared/world/world-gen.js';
import { WorldMap } from '@shared/world/world-map.js';
import { GameWorld } from './game-world.js';
import { initTreeResource } from './systems/resources.js';
import { initCritterAI } from './systems/critter-ai.js';
import type { MovementState, HarvestState, CombatState, CritterState } from './system-state.js';
import type { ConsumableState } from './systems/consumable.js';
import type { Inventory } from '@shared/inventory.js';

// --- Types for serialized data ---

interface WorldMeta {
  worldId: string;
  seed: number;
  createdAt: string;
  savedAt: string;
  tick: number;
  mapWidth: number;
  mapHeight: number;
}

interface SavedEntity {
  id: number;
  position: { tileX: number; tileY: number };
  direction: number;
  waypoint: { tileX: number; tileY: number };
  action: { actionType: number; targetEntity?: number; targetTileX?: number; targetTileY?: number };
  health?: { currentHp: number; maxHp: number };
  blueprintId: number;
  statusEffects: number;
  speed?: number;
}

interface SavedEntities {
  nextEntityId: number;
  nextItemId: number;
  respawnRng: number;
  respawnQueue: { tick: number; blueprintType: number }[];
  entities: SavedEntity[];
  treeResources: [number, number][];
  critterStates: [number, CritterState][];
  moveStates: [number, MovementState][];
  combatStates: [number, CombatState][];
  harvestStates: [number, HarvestState][];
  consumableStates: [number, ConsumableState][];
  inventories: [number, Inventory][];
}

// --- Save ---

export async function saveWorld(
  world: GameWorld,
  worldDir: string,
  meta: WorldMeta,
): Promise<void> {
  await mkdir(worldDir, { recursive: true });

  // Update save timestamp
  meta.savedAt = new Date().toISOString();
  meta.tick = world.currentTick;

  // meta.json
  await writeFile(join(worldDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // map.bin — raw concat of 3 grids
  const mapSize = world.map.width * world.map.height;
  const mapBuf = Buffer.alloc(mapSize * 3);
  mapBuf.set(world.map.terrain, 0);
  mapBuf.set(world.map.buildings, mapSize);
  mapBuf.set(world.map.buildingMeta, mapSize * 2);
  await writeFile(join(worldDir, 'map.bin'), mapBuf);

  // entities.json — all non-player entities + system states
  const playerEntityIds = new Set<number>();
  for (const [eid] of world.players) playerEntityIds.add(eid);

  const entities: SavedEntity[] = [];
  for (const eid of world.entities.getAllEntities()) {
    if (playerEntityIds.has(eid)) continue;
    const pos = world.entities.position.get(eid);
    const dir = world.entities.direction.get(eid);
    const wp = world.entities.nextWaypoint.get(eid);
    const act = world.entities.currentAction.get(eid);
    const hp = world.entities.health.get(eid);
    const bp = world.entities.blueprintId.get(eid);
    const se = world.entities.statusEffects.get(eid);
    const spd = world.entities.speed.get(eid);

    if (!pos || !bp) continue;

    entities.push({
      id: eid,
      position: pos,
      direction: dir?.dir ?? Direction.S,
      waypoint: wp ?? { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE },
      action: act ?? { actionType: ActionType.Idle },
      health: hp,
      blueprintId: bp.blueprintId,
      statusEffects: se?.effects ?? 0,
      speed: spd,
    });
  }

  // Collect system states (excluding player entities)
  const filterMap = <V>(map: ReadonlyMap<number, V>): [number, V][] =>
    [...map].filter(([eid]) => !playerEntityIds.has(eid));

  // Collect entity inventories (non-player: storage chests etc.)
  const inventories: [number, Inventory][] = [];
  for (const [eid, inv] of world.inventoryMgr.getAll()) {
    if (playerEntityIds.has(eid)) continue;
    inventories.push([eid, inv]);
  }

  const data: SavedEntities = {
    nextEntityId: world.entities.getNextId(),
    nextItemId: world.inventoryMgr.getNextItemId(),
    respawnRng: world.respawnRng,
    respawnQueue: [...world.respawnQueue],
    entities,
    treeResources: [...world.treeResources],
    critterStates: filterMap(world.critterStates),
    moveStates: filterMap(world.moveStates),
    combatStates: filterMap(world.combatStates),
    harvestStates: filterMap(world.harvestStates),
    consumableStates: filterMap(world.consumableStates),
    inventories,
  };

  await writeFile(join(worldDir, 'entities.json'), JSON.stringify(data, null, 2));
}

// --- Load ---

export async function loadWorld(worldDir: string): Promise<{ world: GameWorld; meta: WorldMeta }> {
  const metaRaw = await readFile(join(worldDir, 'meta.json'), 'utf-8');
  const meta: WorldMeta = JSON.parse(metaRaw);

  // Reconstruct WorldMap from binary
  const mapBuf = await readFile(join(worldDir, 'map.bin'));
  const mapSize = meta.mapWidth * meta.mapHeight;
  const terrain = new Uint8Array(mapBuf.buffer, mapBuf.byteOffset, mapSize);
  const buildings = new Uint8Array(mapBuf.buffer, mapBuf.byteOffset + mapSize, mapSize);
  const buildingMeta = new Uint8Array(mapBuf.buffer, mapBuf.byteOffset + mapSize * 2, mapSize);
  const map = WorldMap.fromBuffers(meta.mapWidth, meta.mapHeight, terrain, buildings, buildingMeta);

  // Reconstruct GameWorld
  const world = new GameWorld(map, meta.seed);

  const entRaw = await readFile(join(worldDir, 'entities.json'), 'utf-8');
  const data: SavedEntities = JSON.parse(entRaw);

  // Restore ID counters
  world.entities.setNextId(data.nextEntityId);
  world.inventoryMgr.setNextItemId(data.nextItemId);
  world.respawnRng = data.respawnRng;

  // Restore respawn queue (adjust ticks relative to tick 0 on load)
  const tickOffset = meta.tick;
  for (const entry of data.respawnQueue) {
    world.respawnQueue.push({
      tick: entry.tick - tickOffset,
      blueprintType: entry.blueprintType,
    });
  }

  // Restore entities
  for (const ent of data.entities) {
    world.entities.createWithId(ent.id);
    world.entities.position.set(ent.id, ent.position);
    world.entities.direction.set(ent.id, { dir: ent.direction });
    world.entities.nextWaypoint.set(ent.id, ent.waypoint);
    world.entities.currentAction.set(ent.id, ent.action);
    if (ent.health) world.entities.health.set(ent.id, ent.health);
    world.entities.blueprintId.set(ent.id, { blueprintId: ent.blueprintId });
    world.entities.statusEffects.set(ent.id, { effects: ent.statusEffects });
    if (ent.speed !== undefined) world.entities.speed.set(ent.id, ent.speed);

    // Rebuild occupancy from positions
    world.occupancy.set(ent.position.tileX, ent.position.tileY, ent.id);
  }

  // Restore system states
  for (const [eid, state] of data.treeResources) world.treeResources.set(eid, state);
  for (const [eid, state] of data.critterStates) world.critterStates.set(eid, state);
  for (const [eid, state] of data.moveStates) world.moveStates.set(eid, state);
  for (const [eid, state] of data.combatStates) world.combatStates.set(eid, state);
  for (const [eid, state] of data.harvestStates) world.harvestStates.set(eid, state);
  for (const [eid, state] of data.consumableStates) world.consumableStates.set(eid, state);

  // Restore entity inventories (storage chests etc.)
  for (const [eid, inv] of data.inventories) {
    world.inventoryMgr.create(eid, inv.maxWeight);
    for (const item of inv.items) {
      world.inventoryMgr.addItem(eid, item.blueprintId, item.quantity);
    }
  }

  world.entities.clearDirty();

  return { world, meta };
}

// --- Create new world ---

export async function createNewWorld(
  seed: number,
  dataDir: string,
): Promise<{ world: GameWorld; worldId: string; meta: WorldMeta; worldDir: string }> {
  const worldId = randomUUID();
  const worldDir = join(dataDir, 'worlds', worldId);

  // Generate world (same logic as createDefaultWorld)
  const { map, entitySpawns } = generateWorld(seed);
  const world = new GameWorld(map, seed);

  for (const spawn of entitySpawns) {
    const bp = getBlueprint(spawn.blueprint);
    if (!bp) continue;
    const eid = world.entities.create();
    world.entities.position.set(eid, { tileX: spawn.x, tileY: spawn.y });
    world.entities.direction.set(eid, { dir: Direction.S });
    world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    if (bp.maxHp) world.entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
    world.entities.blueprintId.set(eid, { blueprintId: spawn.blueprint });
    world.entities.statusEffects.set(eid, { effects: 0 });
    if (bp.speed) world.entities.speed.set(eid, bp.speed);
    world.occupancy.set(spawn.x, spawn.y, eid);
    if (spawn.blueprint === BlueprintType.Tree) initTreeResource(eid, world);
  }
  world.entities.clearDirty();
  initCritterAI(world);

  const meta: WorldMeta = {
    worldId,
    seed,
    createdAt: new Date().toISOString(),
    savedAt: new Date().toISOString(),
    tick: 0,
    mapWidth: map.width,
    mapHeight: map.height,
  };

  await saveWorld(world, worldDir, meta);

  return { world, worldId, meta, worldDir };
}
