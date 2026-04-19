// Keyboard controller — manages chat input mode, debug toggle, and the
// inventory-panel open/close toggle. Attaches to the canvas element
// (requires tabindex="0" for focus). Returns a KeyboardState read by the
// renderer + mouse controller each frame.

import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import type { Connection } from '../network/connection.js';
import type { Scene } from '../scene.js';
import { isPlacementActive } from '../ui/placement.js';
import { markPendingDecrement } from '../ui/inventory-panel.js';

const MAX_CHAT_LENGTH = 200;

export interface KeyboardState {
  /** True when the chat text input is active. */
  chatActive: boolean;
  /** Current chat input buffer. */
  chatBuffer: string;
  /** True when debug overlay is active. */
  debugMode: boolean;
}

export function attachKeyboardControls(
  canvas: HTMLCanvasElement,
  connection: Connection,
  scene: Scene,
): KeyboardState {
  const state: KeyboardState = {
    chatActive: false,
    chatBuffer: '',
    debugMode: false,
  };

  // Close the inventory panel. If the player was holding a stack on the
  // cursor, drop it at their feet (Minecraft default). Also closes any
  // open container client-side — the server's view lingers until the
  // player moves away, but the local UI releases immediately.
  function closeInventory() {
    if (scene.heldStack) {
      markPendingDecrement(scene, scene.heldStack.itemId, scene.heldStack.quantity);
      if (scene.heldStack.source === 'container' && scene.containerEntityId !== null) {
        // Don't accidentally drop a chest item to the world; return it.
        connection.send({
          action: ClientAction.Transfer,
          itemId: scene.heldStack.itemId,
          containerId: scene.containerEntityId,
          direction: 1,
          quantity: scene.heldStack.quantity,
        });
      } else {
        connection.send({
          action: ClientAction.Drop,
          itemId: scene.heldStack.itemId,
          quantity: scene.heldStack.quantity,
        });
      }
      scene.heldStack = null;
    }
    scene.inventoryOpen = false;
    scene.containerEntityId = null;
    scene.containerItems = [];
  }

  canvas.addEventListener('keydown', (ev) => {
    // --- Chat mode ---
    if (state.chatActive) {
      if (ev.key === 'Enter') {
        if (state.chatBuffer.length > 0) {
          if (state.chatBuffer.startsWith('/')) {
            const m = state.chatBuffer.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
            if (m) {
              connection.send({
                action: ClientAction.ServerCommand,
                command: m[1],
                parameter: m[2],
              });
            }
          } else {
            connection.send({ action: ClientAction.Say, message: state.chatBuffer });
          }
        }
        state.chatBuffer = '';
        state.chatActive = false;
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape') {
        state.chatBuffer = '';
        state.chatActive = false;
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Backspace') {
        state.chatBuffer = state.chatBuffer.slice(0, -1);
        ev.preventDefault();
        return;
      }
      // Printable character (single char, no ctrl/alt/meta modifier).
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (state.chatBuffer.length < MAX_CHAT_LENGTH) {
          state.chatBuffer += ev.key;
        }
        ev.preventDefault();
        return;
      }
      // Let unhandled keys (arrows, etc.) fall through without preventDefault.
      return;
    }

    // --- Inventory open: Esc closes, I toggles shut ---
    if (scene.inventoryOpen) {
      if (ev.key === 'Escape' || ev.key === 'i' || ev.key === 'I') {
        closeInventory();
        ev.preventDefault();
        return;
      }
      // Swallow other keys so world input doesn't fire underneath.
      return;
    }

    // --- Not in chat mode, inventory closed ---
    // Esc during placement mode unequips the hand slot.
    if (ev.key === 'Escape' && isPlacementActive(scene)) {
      connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
      scene.placementHoverTile = null;
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Enter') {
      state.chatActive = true;
      ev.preventDefault();
      return;
    }
    if (ev.key === 'q' || ev.key === 'Q') {
      state.debugMode = !state.debugMode;
      ev.preventDefault();
      return;
    }
    if (ev.key === 'i' || ev.key === 'I') {
      scene.inventoryOpen = true;
      ev.preventDefault();
      return;
    }
  });

  return state;
}
