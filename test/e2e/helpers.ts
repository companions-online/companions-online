import { WorldMap } from '../../shared/src/world/world-map.js';
import { Direction } from '../../shared/src/direction.js';
import { ActionType } from '../../shared/src/actions.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import { WAYPOINT_NONE } from '../../shared/src/components.js';
import { MAP_SIZE } from '../../shared/src/constants.js';
import { GameWorld } from '../../server/src/game-world.js';
import { HeadlessConnection } from '../../server/src/connections/headless-connection.js';
import { initTreeResource } from '../../server/src/systems/resources.js';

export function createTestWorld(opts?: {
  width?: number;
  height?: number;
  setupMap?: (map: WorldMap) => void;
}): GameWorld {
  const w = opts?.width ?? MAP_SIZE;
  const h = opts?.height ?? MAP_SIZE;
  const map = new WorldMap(w, h);
  if (opts?.setupMap) opts.setupMap(map);
  return new GameWorld(map, 1);
}

export function addTestPlayer(world: GameWorld, x: number, y: number): {
  entityId: number;
  connection: HeadlessConnection;
} {
  const connection = new HeadlessConnection();
  const entityId = world.addPlayer(connection);

  // Override position to exact coordinates
  const pos = world.entities.position.get(entityId);
  if (pos) {
    world.occupancy.clear(pos.tileX, pos.tileY);
  }
  world.entities.position.set(entityId, { tileX: x, tileY: y });
  world.occupancy.set(x, y, entityId);

  return { entityId, connection };
}

export function placeTree(world: GameWorld, x: number, y: number): number {
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.direction.set(eid, { dir: Direction.S });
  world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  world.entities.health.set(eid, { currentHp: 50, maxHp: 50 });
  world.entities.blueprintId.set(eid, { blueprintId: BlueprintType.Tree });
  world.entities.statusEffects.set(eid, { effects: 0 });
  world.occupancy.set(x, y, eid);
  initTreeResource(eid, world);
  return eid;
}

export function placeGroundItem(world: GameWorld, blueprintId: number, x: number, y: number): number {
  const eid = world.entities.create();
  world.entities.position.set(eid, { tileX: x, tileY: y });
  world.entities.blueprintId.set(eid, { blueprintId });
  return eid;
}
