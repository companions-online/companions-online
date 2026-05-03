// In-process bridge that lets the WebGL client talk to a GameWorld running
// in the same browser tab — the "virtual network" peer of connection.ts.
// Implements both halves:
//
//   * `PlayerConnection` (server-facing): every callback the GameWorld makes
//     into a player's transport is forwarded straight into the client `Scene`,
//     bypassing the binary protocol. Decoded* shapes already match what
//     `wire-scene.ts` would deliver, so the routing is mechanical.
//
//   * `Connection` (client-facing): the keyboard/mouse controllers call
//     `send(action)` here, and we hand the action straight to
//     `world.setAction(myEntityId, action)` — no codec round-trip.
//
// The class captures `myEntityId` from the first `onInitialState` call,
// because `world.addPlayer(conn)` invokes that callback synchronously
// before returning.
//
// `bootStandalone(scene, seed)` (bottom of file) is the standalone-mode boot
// factory: spin up createDefaultWorld + GameLoop + StandaloneConnection +
// addPlayer, return the Connection for main.ts to wire into controls.

import { TICK_RATE, INTEREST_RANGE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { gameMinuteFromTick } from '@shared/lighting.js';
import { MetaKey } from '@shared/entity-meta.js';
import type { DecodedAction, DecodedServerMessage } from '@shared/protocol/codec.js';
import type { GameWorld } from '@server/game-world.js';
import { createDefaultWorld } from '@server/game-world.js';
import { GameLoop } from '@server/ecs/game-loop.js';
import type { PlayerConnection, TickDelta, GameWorldView } from '@server/player-connection.js';
import type { GameEvent } from '@server/events.js';
import type { RejectionReason } from '@server/action-rejection.js';
import { toWireEvent } from '@server/connections/wire-event-map.js';
import type { Connection } from './connection.js';
import type { Scene } from '../scene.js';
import { startObserverCamera, type ObserverCamera } from '../controls/observer-camera.js';

export class StandaloneConnection implements PlayerConnection, Connection {
  private myEntityId = 0;
  private open = true;

  constructor(private world: GameWorld, private scene: Scene) {}

  // --- Connection (client-facing) ---

  get isOpen(): boolean { return this.open; }

  // Server state arrives directly via the PlayerConnection methods below;
  // there is no inbound message stream to wire up. Accept the handler so
  // the interface stays satisfied.
  onMessage(_handler: (msg: DecodedServerMessage) => void): void { /* noop */ }

  send(action: DecodedAction): void {
    if (!this.open || this.myEntityId === 0) return;
    this.world.setAction(this.myEntityId, action);
  }

  close(): void { this.open = false; }

  // --- PlayerConnection (server-facing) ---

  onInitialState(entityId: number, world: GameWorldView): void {
    this.myEntityId = entityId;
    const playerPos = world.entities.position.get(entityId);
    if (!playerPos) return;

    this.scene.onWelcome(entityId, world.seed);
    this.scene.onEnvironmentSync(
      gameMinuteFromTick(world.effectiveTick),
      world.weather,
      world.currentTick,
    );

    // Chunks are streamed by GameWorld via onChunkNeeded before this call.

    for (const eid of world.entities.getAllEntities()) {
      const pos = world.entities.position.get(eid);
      if (!pos) continue;
      if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE
       && Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
        const { components, speed } = world.entities.getFullState(eid);
        this.scene.onEntityFull({ entityId: eid, components, speed });
        this.sendMetaFor(eid, world);
      }
    }

    this.scene.onInventorySync(world.inventoryMgr.getSyncData(entityId));
  }

  onChunkNeeded(chunkX: number, chunkY: number, world: GameWorldView): void {
    this.scene.onChunk({
      chunkX,
      chunkY,
      terrain: world.map.getChunkTerrain(chunkX, chunkY),
      buildings: world.map.getChunkBuildings(chunkX, chunkY),
      buildingMeta: world.map.getChunkBuildingMeta(chunkX, chunkY),
    });
  }

  onInventoryChanged(entityId: number, world: GameWorldView): void {
    this.scene.onInventorySync(world.inventoryMgr.getSyncData(entityId));
  }

  onTick(_entityId: number, world: GameWorldView, delta: TickDelta): void {
    for (const eid of delta.entered) {
      const { components, speed } = world.entities.getFullState(eid);
      this.scene.onEntityFull({ entityId: eid, components, speed });
      this.sendMetaFor(eid, world);
    }
    for (const u of delta.updated) this.scene.onEntityUpdate(u);
    for (const id of delta.left) this.scene.onEntityRemoval(id);
    for (const tu of delta.tileUpdates) this.scene.onTileUpdate(tu);
    if (delta.environment) {
      this.scene.onEnvironmentSync(
        delta.environment.gameMinute,
        delta.environment.weather,
        delta.tick,
      );
    }
  }

  onContainerOpen(_entityId: number, containerEntityId: number, world: GameWorldView): void {
    this.scene.onContainerOpen(
      containerEntityId,
      world.inventoryMgr.getSyncData(containerEntityId),
    );
  }

  onDialogueOpen(
    _entityId: number,
    npcEntityId: number,
    dialogue: Parameters<PlayerConnection['onDialogueOpen']>[2],
  ): void {
    this.scene.onDialogueOpen(npcEntityId, dialogue);
  }

  onChatMessage(_entityId: number, senderEntityId: number, message: string): void {
    this.scene.onChatMessage(senderEntityId, message);
  }

  // Point-to-point events are MCP-only on the WS path; the standalone
  // bridge mirrors that — visual events come in via onBroadcastEvent.
  onGameEvent(_entityId: number, _event: GameEvent): void { /* noop */ }

  onBroadcastEvent(_entityId: number, event: GameEvent): void {
    const wire = toWireEvent(event);
    if (wire) this.scene.onGameEvent(wire, this.world.currentTick);
  }

  onEntityMeta(_entityId: number, targetEntityId: number, key: MetaKey, value: string): void {
    this.scene.onEntityMeta(targetEntityId, key, value);
  }

  // WS clients render their own collision feedback; same here — the cursor
  // and motion prediction already give the user enough to recover.
  onActionRejected(_entityId: number, _reason: RejectionReason): void { /* noop */ }

  private sendMetaFor(eid: number, world: GameWorldView): void {
    const bucket = world.entityMeta.get(eid);
    if (!bucket) return;
    for (const [key, value] of bucket) {
      this.scene.onEntityMeta(eid, key, value);
    }
  }
}

/** Spin up an in-tab GameWorld + GameLoop, attach a StandaloneConnection,
 *  add the local player. Returned `conn` plugs into controls and renderer
 *  the same way the WS Connection does. The world + loop refs are returned
 *  for the menu/observer-mode work to drive in later phases. */
export function bootStandalone(scene: Scene, seed: number): {
  conn: StandaloneConnection;
  world: GameWorld;
  loop: GameLoop;
} {
  const world = createDefaultWorld(seed);
  const conn = new StandaloneConnection(world, scene);
  // addPlayer fires onChunkNeeded + onInitialState synchronously, populating
  // the scene before render starts.
  const eid = world.addPlayer(conn);
  // Match the WS path's default name so nameplates / chat-from-self render
  // consistently. WS players get this in app.ts; standalone does it here.
  world.setEntityMeta(eid, MetaKey.Name, 'Player');

  // Tick the world at TICK_RATE on top of RAF. GameLoop is browser-safe
  // (performance.now + setTimeout) and keeps drift compensation.
  const loop = new GameLoop(TICK_RATE);
  loop.start(() => world.runTick());

  return { conn, world, loop };
}

/** PlayerConnection peer of `StandaloneConnection` for observer mode. The
 *  observer has no entity in the world, no inventory, no actions — just a
 *  focus point that drives chunk + entity streaming. The `Connection`
 *  half's `send` is a no-op (observers can't act); the rest of the surface
 *  routes server callbacks into the scene the same way the player bridge
 *  does, with player-only callbacks no-oped. */
export class StandaloneObserverConnection implements PlayerConnection, Connection {
  private open = true;

  constructor(private world: GameWorld, private scene: Scene) {}

  // --- Connection (client-facing) ---

  get isOpen(): boolean { return this.open; }
  onMessage(_handler: (msg: DecodedServerMessage) => void): void { /* noop */ }
  send(_action: DecodedAction): void { /* observer can't act */ }
  close(): void { this.open = false; }

  // --- PlayerConnection (server-facing) ---

  onInitialState(_entityId: number, world: GameWorldView): void {
    // entityId=0 is the observer sentinel; scene.onWelcome treats it as
    // "leave myEntityId null." Entities arrive on the first tick via the
    // entered channel; chunks were already streamed by addObserver before
    // this call.
    this.scene.onWelcome(0, world.seed);
    this.scene.onEnvironmentSync(
      gameMinuteFromTick(world.effectiveTick),
      world.weather,
      world.currentTick,
    );
  }

  onChunkNeeded(chunkX: number, chunkY: number, world: GameWorldView): void {
    this.scene.onChunk({
      chunkX, chunkY,
      terrain: world.map.getChunkTerrain(chunkX, chunkY),
      buildings: world.map.getChunkBuildings(chunkX, chunkY),
      buildingMeta: world.map.getChunkBuildingMeta(chunkX, chunkY),
    });
  }

  onTick(_entityId: number, world: GameWorldView, delta: TickDelta): void {
    for (const eid of delta.entered) {
      const { components, speed } = world.entities.getFullState(eid);
      this.scene.onEntityFull({ entityId: eid, components, speed });
      this.sendMetaFor(eid, world);
    }
    for (const u of delta.updated) this.scene.onEntityUpdate(u);
    for (const id of delta.left) this.scene.onEntityRemoval(id);
    for (const tu of delta.tileUpdates) this.scene.onTileUpdate(tu);
    if (delta.environment) {
      this.scene.onEnvironmentSync(
        delta.environment.gameMinute,
        delta.environment.weather,
        delta.tick,
      );
    }
  }

  onBroadcastEvent(_entityId: number, event: GameEvent): void {
    const wire = toWireEvent(event);
    if (wire) this.scene.onGameEvent(wire, this.world.currentTick);
  }

  onEntityMeta(_entityId: number, targetEntityId: number, key: MetaKey, value: string): void {
    this.scene.onEntityMeta(targetEntityId, key, value);
  }

  onChatMessage(_entityId: number, senderEntityId: number, message: string): void {
    this.scene.onChatMessage(senderEntityId, message);
  }

  // Observer-irrelevant — server never fires these for observers, but the
  // PlayerConnection interface requires them.
  onInventoryChanged(): void { /* observer has no inventory */ }
  onContainerOpen(): void { /* observer can't open containers */ }
  onDialogueOpen(): void { /* observer can't open dialogues */ }
  onGameEvent(): void { /* point-to-point events are player-only */ }
  onActionRejected(_entityId: number, _reason: RejectionReason): void { /* observer can't be rejected */ }

  private sendMetaFor(eid: number, world: GameWorldView): void {
    const bucket = world.entityMeta.get(eid);
    if (!bucket) return;
    for (const [key, value] of bucket) {
      this.scene.onEntityMeta(eid, key, value);
    }
  }
}

/** Standalone observer boot. Spins up an in-tab GameWorld, registers an
 *  observer at SPAWN, starts the autopilot camera, returns the refs.
 *  No player is added — the world ticks under the observer's gaze, NPCs
 *  and critters do their thing, and the camera pans across them
 *  cinematically. The menu's "Play" button later tears this down (or
 *  upgrades the observer to a player on the same world). */
export function bootStandaloneObserver(scene: Scene, seed: number): {
  conn: StandaloneObserverConnection;
  world: GameWorld;
  loop: GameLoop;
  observerId: number;
  camera: ObserverCamera;
} {
  const world = createDefaultWorld(seed);
  const conn = new StandaloneObserverConnection(world, scene);
  const observerId = world.addObserver(conn, SPAWN_X, SPAWN_Y);

  const loop = new GameLoop(TICK_RATE);
  loop.start(() => world.runTick());

  const camera = startObserverCamera(
    scene,
    (x, y) => world.setObserverFocus(observerId, x, y),
    SPAWN_X, SPAWN_Y,
  );
  scene.observerCamera = camera;

  return { conn, world, loop, observerId, camera };
}
