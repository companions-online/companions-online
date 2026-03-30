import { WebSocketServer, WebSocket } from 'ws';
import { TICK_RATE, MAP_SIZE, CHUNK_SIZE, SPAWN_X, SPAWN_Y, INTEREST_RANGE } from '@shared/constants.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import {
  encodeWelcome, encodeChunk, encodeEntityFullState,
  encodeWorldDelta, encodePong, decodeClientMessage, encodeInventorySync,
} from '@shared/protocol/codec.js';
import type { DecodedAction, DecodedEntityUpdate, DecodedActionPickup, DecodedActionEquip, DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft } from '@shared/protocol/codec.js';
import { numberToEquipSlot } from '@shared/inventory.js';
import { EntityManager } from './ecs/entity-manager.js';
import { GameLoop } from './ecs/game-loop.js';
import { setMoveTarget, clearMoveTarget, runMovement } from './systems/movement.js';
import { initCritterAI, runCritterAI } from './systems/critter-ai.js';
import { OccupancyGrid } from './occupancy.js';
import { InventoryManager } from './inventory-manager.js';

const PORT = 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 42;

// --- World generation ---
console.log(`[server] generating world (seed=${WORLD_SEED})...`);
const { map, entitySpawns } = generateWorld(WORLD_SEED);
console.log(`[server] world ready: ${entitySpawns.length} entity spawns`);

// --- ECS setup ---
const entities = new EntityManager();

// Spawn world entities (trees, rocks, critters)
for (const spawn of entitySpawns) {
  const bp = getBlueprint(spawn.blueprint);
  if (!bp) continue;
  const eid = entities.create();
  entities.position.set(eid, { tileX: spawn.x, tileY: spawn.y });
  entities.direction.set(eid, { dir: Direction.S });
  entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  entities.currentAction.set(eid, { actionType: ActionType.Idle });
  if (bp.maxHp) entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
  entities.blueprintId.set(eid, { blueprintId: spawn.blueprint });
  entities.statusEffects.set(eid, { effects: 0 });
  if (bp.speed) entities.speed.set(eid, bp.speed);
}
entities.clearDirty();

// --- Occupancy grid ---
const occupancy = new OccupancyGrid(MAP_SIZE, MAP_SIZE);
for (const eid of entities.getAllEntities()) {
  const pos = entities.position.get(eid);
  if (pos) occupancy.set(pos.tileX, pos.tileY, eid);
}

initCritterAI(entities);

// --- Inventory manager ---
const inventoryMgr = new InventoryManager();
console.log(`[server] ${entities.getEntityCount()} entities created`);

// --- Client sessions ---
interface ClientSession {
  ws: WebSocket;
  entityId: number;
  knownEntities: Set<number>;
  pendingAction: DecodedAction | null;
}
const sessions = new Map<WebSocket, ClientSession>();

// Simple RNG for spawn offsets
let spawnRng = WORLD_SEED;
function nextSpawnOffset(): number {
  spawnRng = (spawnRng * 1664525 + 1013904223) >>> 0;
  return (spawnRng % 5) - 2; // -2..2
}

function createPlayerEntity(): number {
  const bp = getBlueprint(BlueprintType.Player)!;
  const eid = entities.create();

  // Find walkable spawn position
  let sx = SPAWN_X + nextSpawnOffset();
  let sy = SPAWN_Y + nextSpawnOffset();
  for (let attempts = 0; attempts < 20; attempts++) {
    if (map.isWalkable(sx, sy)) break;
    sx = SPAWN_X + nextSpawnOffset();
    sy = SPAWN_Y + nextSpawnOffset();
  }

  entities.position.set(eid, { tileX: sx, tileY: sy });
  entities.direction.set(eid, { dir: Direction.S });
  entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  entities.currentAction.set(eid, { actionType: ActionType.Idle });
  entities.health.set(eid, { currentHp: bp.maxHp ?? 100, maxHp: bp.maxHp ?? 100 });
  entities.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
  entities.statusEffects.set(eid, { effects: 0 });
  entities.speed.set(eid, bp.speed ?? 3);
  occupancy.set(sx, sy, eid);

  // Starter inventory
  inventoryMgr.create(eid, 50);
  inventoryMgr.addItem(eid, BlueprintType.Wood, 2);
  inventoryMgr.addItem(eid, BlueprintType.Rock, 1);

  return eid;
}

function sendInitialState(session: ClientSession): void {
  const { ws, entityId } = session;
  const playerPos = entities.position.get(entityId);
  if (!playerPos) return;

  // Send Welcome
  ws.send(encodeWelcome(entityId));

  // Send all chunks (128/16 = 8x8 chunks, small enough to send all)
  const chunksPerSide = MAP_SIZE / CHUNK_SIZE;
  for (let cy = 0; cy < chunksPerSide; cy++) {
    for (let cx = 0; cx < chunksPerSide; cx++) {
      ws.send(encodeChunk(
        cx, cy,
        map.getChunkTerrain(cx, cy),
        map.getChunkBuildings(cx, cy),
        map.getChunkBuildingMeta(cx, cy),
      ));
    }
  }

  // Send EntityFullState for all entities in interest range
  for (const eid of entities.getAllEntities()) {
    const pos = entities.position.get(eid);
    if (!pos) continue;
    if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE &&
        Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
      const { components, speed } = entities.getFullState(eid);
      ws.send(encodeEntityFullState(eid, components, speed));
      session.knownEntities.add(eid);
    }
  }

  // Send initial inventory
  sendInventorySync(session);
}

function sendInventorySync(session: ClientSession): void {
  session.ws.send(encodeInventorySync(inventoryMgr.getSyncData(session.entityId)));
}

// --- Per-tick broadcast ---
function broadcastTick(tick: number): void {
  const dirty = entities.getDirtyEntities();
  const destroyed = entities.getDestroyed();

  for (const [, session] of sessions) {
    const playerPos = entities.position.get(session.entityId);
    if (!playerPos) continue;

    const entered: number[] = [];
    const left: number[] = [];
    const updates: DecodedEntityUpdate[] = [];

    // Check all alive entities for visibility
    for (const eid of entities.getAllEntities()) {
      const pos = entities.position.get(eid);
      if (!pos) continue;
      const inRange = Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE
                   && Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE;

      if (inRange && !session.knownEntities.has(eid)) {
        entered.push(eid);
        session.knownEntities.add(eid);
      } else if (!inRange && session.knownEntities.has(eid)) {
        left.push(eid);
        session.knownEntities.delete(eid);
      }
    }

    // Destroyed entities the client knew about
    for (const eid of destroyed) {
      if (session.knownEntities.has(eid)) {
        left.push(eid);
        session.knownEntities.delete(eid);
      }
    }

    // Dirty entities still in known set → delta updates
    for (const [eid, bitmask] of dirty) {
      if (session.knownEntities.has(eid)) {
        updates.push({ entityId: eid, components: entities.getDeltaComponents(eid, bitmask) });
      }
    }

    // Send EntityFullState for entered entities
    for (const eid of entered) {
      const { components, speed } = entities.getFullState(eid);
      session.ws.send(encodeEntityFullState(eid, components, speed));
    }

    // Send WorldDelta with updates + removals
    if (updates.length > 0 || left.length > 0) {
      session.ws.send(encodeWorldDelta(tick, updates, left, []));
    }
  }
}

// --- Game loop ---
const loop = new GameLoop(TICK_RATE);

loop.start((tick, _dt) => {
  // 1. Process pending actions
  for (const [, session] of sessions) {
    const action = session.pendingAction;
    if (!action) continue;
    session.pendingAction = null;

    if (action.action === ClientAction.MoveTo) {
      const a = action as { action: number; tileX: number; tileY: number };
      if (map.isWalkable(a.tileX, a.tileY)) {
        setMoveTarget(session.entityId, a.tileX, a.tileY, entities, map, occupancy);
      }
    } else if (action.action === ClientAction.Cancel) {
      clearMoveTarget(session.entityId);
    } else if (action.action === ClientAction.Pickup) {
      const a = action as DecodedActionPickup;
      const targetPos = entities.position.get(a.entityId);
      const playerPos = entities.position.get(session.entityId);
      if (targetPos && playerPos) {
        const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
        const bp = entities.blueprintId.get(a.entityId);
        const bpDef = bp ? getBlueprint(bp.blueprintId) : undefined;
        if (dist <= 1 && bpDef && (bpDef.category === 'item' || bpDef.category === 'resource')) {
          const result = inventoryMgr.addItem(session.entityId, bp!.blueprintId, 1);
          if (result.success) {
            occupancy.clear(targetPos.tileX, targetPos.tileY);
            entities.destroy(a.entityId);
            sendInventorySync(session);
          }
        }
      }
    } else if (action.action === ClientAction.Equip) {
      const a = action as DecodedActionEquip;
      if (inventoryMgr.equip(session.entityId, a.itemId)) {
        sendInventorySync(session);
      }
    } else if (action.action === ClientAction.Unequip) {
      const a = action as DecodedActionUnequip;
      const slot = numberToEquipSlot(a.slot);
      if (slot && inventoryMgr.unequip(session.entityId, slot)) {
        sendInventorySync(session);
      }
    } else if (action.action === ClientAction.Drop) {
      const a = action as DecodedActionDrop;
      const dropped = inventoryMgr.drop(session.entityId, a.itemId);
      if (dropped) {
        const playerPos = entities.position.get(session.entityId);
        if (playerPos) {
          const groundEid = entities.create();
          entities.position.set(groundEid, { tileX: playerPos.tileX, tileY: playerPos.tileY });
          entities.blueprintId.set(groundEid, { blueprintId: dropped.blueprintId });
        }
        sendInventorySync(session);
      }
    } else if (action.action === ClientAction.Craft) {
      const a = action as DecodedActionCraft;
      if (inventoryMgr.craft(session.entityId, a.recipeId)) {
        sendInventorySync(session);
      }
    }
  }

  // 2. Critter AI
  runCritterAI(entities, map, occupancy);

  // 3. Run movement
  runMovement(entities, map, occupancy);

  // 3. Broadcast
  broadcastTick(tick);

  // 4. Clear
  entities.clearDirty();
  entities.clearDestroyed();

  if (tick % TICK_RATE === 0) {
    console.log(`[server] tick=${tick} entities=${entities.getEntityCount()} clients=${sessions.size}`);
  }
});

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`[server] listening on ws://localhost:${PORT} (${TICK_RATE}Hz, ${MAP_SIZE}x${MAP_SIZE}, seed=${WORLD_SEED})`);
});

wss.on('connection', (ws) => {
  const entityId = createPlayerEntity();
  const session: ClientSession = {
    ws,
    entityId,
    knownEntities: new Set(),
    pendingAction: null,
  };
  sessions.set(ws, session);

  console.log(`[server] client connected as entity #${entityId} (total: ${sessions.size})`);

  // Send initial state
  sendInitialState(session);

  // Broadcast this new player to all OTHER sessions
  for (const [otherWs, otherSession] of sessions) {
    if (otherWs === ws) continue;
    const otherPos = entities.position.get(otherSession.entityId);
    const newPos = entities.position.get(entityId);
    if (!otherPos || !newPos) continue;
    if (Math.abs(newPos.tileX - otherPos.tileX) <= INTEREST_RANGE &&
        Math.abs(newPos.tileY - otherPos.tileY) <= INTEREST_RANGE) {
      const { components, speed } = entities.getFullState(entityId);
      otherWs.send(encodeEntityFullState(entityId, components, speed));
      otherSession.knownEntities.add(entityId);
    }
  }

  ws.on('message', (data) => {
    try {
      const raw = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
      const buf = raw as ArrayBuffer;
      const msg = decodeClientMessage(buf);
      if (msg.type === 'action') {
        session.pendingAction = msg.data;
      } else if (msg.type === 'ping') {
        ws.send(encodePong(msg.clientTime));
      }
    } catch (e) {
      console.error('[server] bad message:', e);
    }
  });

  ws.on('close', () => {
    const pos = entities.position.get(entityId);
    if (pos) occupancy.clear(pos.tileX, pos.tileY);
    entities.destroy(entityId);
    clearMoveTarget(entityId);
    inventoryMgr.destroy(entityId);
    sessions.delete(ws);
    console.log(`[server] client #${entityId} disconnected (total: ${sessions.size})`);
  });
});
