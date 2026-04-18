// Dispatch decoded server messages into the matching scene mutators. Called
// once by main.ts after connect() returns. Tests wire a fake Connection into
// the same function so the same dispatch logic runs in both paths.

import type { Scene } from '../scene.js';
import type { Connection } from './connection.js';

export function wireSceneToConnection(scene: Scene, conn: Connection): void {
  conn.onMessage((msg) => {
    switch (msg.type) {
      case 'welcome':         scene.onWelcome(msg.entityId, msg.seed); break;
      case 'chunk':           scene.onChunk(msg.data); break;
      case 'entityFullState': scene.onEntityFull(msg.data); break;
      case 'worldDelta':
        if (msg.data.environment) {
          scene.onEnvironmentSync(
            msg.data.environment.gameMinute,
            msg.data.environment.weather,
            msg.data.tick,
          );
        }
        for (const eu of msg.data.entityUpdates) scene.onEntityUpdate(eu);
        for (const id of msg.data.entityRemovals) scene.onEntityRemoval(id);
        for (const tu of msg.data.tileUpdates) scene.onTileUpdate(tu);
        break;
      case 'inventorySync':    scene.onInventorySync(msg.items); break;
      case 'containerOpen':    scene.onContainerOpen(msg.containerEntityId, msg.items); break;
      case 'dialogueOpen':     scene.onDialogueOpen(msg.npcEntityId, msg.dialogue); break;
      case 'chatMessage':      scene.onChatMessage(msg.senderEntityId, msg.message); break;
      case 'environmentSync':  scene.onEnvironmentSync(msg.gameMinute, msg.weather, msg.serverTick); break;
    }
  });
}
