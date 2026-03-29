import { WebSocketServer } from 'ws';
import { TICK_RATE, MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { EntityManager } from './ecs/entity-manager.js';
import { GameLoop } from './ecs/game-loop.js';

const PORT = 3001;

const entities = new EntityManager();
const loop = new GameLoop(TICK_RATE);

// Create a test player entity at spawn
const playerId = entities.create();
const playerBp = getBlueprint(BlueprintType.Player)!;
entities.position.set(playerId, { tileX: SPAWN_X, tileY: SPAWN_Y });
entities.direction.set(playerId, { dir: Direction.S });
entities.nextWaypoint.set(playerId, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
entities.currentAction.set(playerId, { actionType: ActionType.Idle });
entities.health.set(playerId, { currentHp: playerBp.maxHp, maxHp: playerBp.maxHp });
entities.blueprintId.set(playerId, { blueprintId: BlueprintType.Player });
entities.statusEffects.set(playerId, { effects: 0 });
entities.speed.set(playerId, playerBp.speed);
entities.clearDirty(); // initial setup isn't a delta

// Tick callback
loop.start((tick, dt) => {
  // (Future: process client actions)
  // (Future: run movement system)
  // (Future: run game systems)
  // (Future: broadcast deltas)

  const dirtyCount = entities.getDirtyEntities().size;
  entities.clearDirty();

  if (tick % TICK_RATE === 0) {
    console.log(`[server] tick=${tick} entities=${entities.getEntityCount()} dirty=${dirtyCount} dt=${dt.toFixed(1)}ms`);
  }
});

// WebSocket server
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`[server] listening on ws://localhost:${PORT} (${TICK_RATE}Hz, ${MAP_SIZE}x${MAP_SIZE} map, spawn ${SPAWN_X},${SPAWN_Y})`);
});

wss.on('connection', (ws) => {
  console.log(`[server] client connected (total: ${wss.clients.size})`);

  ws.on('close', () => {
    console.log(`[server] client disconnected (total: ${wss.clients.size})`);
  });
});
