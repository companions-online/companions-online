// Keyboard controller — manages chat input mode and the inventory-panel
// open/close toggle. Attaches to the canvas element (requires tabindex="0"
// for focus). Returns a KeyboardState read by the renderer + mouse
// controller each frame.

import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import type { Connection } from '../network/connection.js';
import type { Scene } from '../scene.js';
import { isPlacementActive } from '../ui/placement.js';
import { closeInventory } from '../ui/inventory-panel.js';
import { selectQuickSlot, clearQuickSlotSelection } from '../ui/quickslot.js';
import { isInventoryShowing } from '../overlay.js';

const MAX_CHAT_LENGTH = 200;

export interface KeyboardState {
  /** True when the chat text input is active. */
  chatActive: boolean;
  /** Current chat input buffer. */
  chatBuffer: string;
}

export function attachKeyboardControls(
  canvas: HTMLCanvasElement,
  connection: Connection,
  scene: Scene,
): KeyboardState {
  const state: KeyboardState = {
    chatActive: false,
    chatBuffer: '',
  };

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

    // --- Menu open: world keyboard fully no-ops. menu-input.ts owns input
    //     while the main-menu overlay is up; Tab/Esc/Enter and printable
    //     keys all route through there. ---
    if (scene.overlay.kind === 'menu') return;

    // --- Inventory open: Esc closes, I toggles shut, 1..9 still drive
    //     quickslot selection so the player can swap hand items while
    //     browsing. Other keys are swallowed so world input doesn't fire
    //     underneath the panel. ---
    if (isInventoryShowing(scene.overlay)) {
      if (ev.key === 'Escape' || ev.key === 'i' || ev.key === 'I') {
        closeInventory(scene, connection);
        ev.preventDefault();
        return;
      }
      if (ev.key.length === 1 && ev.key >= '1' && ev.key <= '9') {
        selectQuickSlot(scene, connection, ev.key.charCodeAt(0) - '1'.charCodeAt(0));
        ev.preventDefault();
        return;
      }
      return;
    }

    // --- Not in chat mode, inventory closed ---
    // Esc clears any quickslot selection first (also unequips hand if
    // the selected slot was equippable). Only then falls through.
    if (ev.key === 'Escape' && scene.selectedQuickSlot !== null) {
      clearQuickSlotSelection(scene, connection);
      scene.placementHoverTile = null;
      ev.preventDefault();
      return;
    }
    // Esc during placement mode unequips the hand slot (legacy path; the
    // selection-clear above usually runs first, but keep this as a safety
    // net for edge cases where a placeable is in hand without a
    // selection — e.g. a stale equip state from before this feature).
    if (ev.key === 'Escape' && isPlacementActive(scene)) {
      connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
      scene.placementHoverTile = null;
      ev.preventDefault();
      return;
    }
    // No inventory, no quickslot, no placement — Esc opens the in-game
    // settings menu. Earlier branches above each return on Esc, so they
    // take priority (open inventory + Esc still closes inventory, etc.).
    //
    // stopImmediatePropagation: the menu-input listener (registered after
    // this one on the same canvas) gates on `overlay.kind === 'menu'` and
    // would see the just-mutated overlay, dispatching this same Esc to the
    // menu's escapeAction — which would close the menu we just opened.
    if (ev.key === 'Escape') {
      scene.armedAction = null;
      scene.overlay = { kind: 'menu', screen: 'settings', context: 'in-game' };
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    if (ev.key === 'Enter') {
      state.chatActive = true;
      ev.preventDefault();
      return;
    }
    if (ev.key === 'i' || ev.key === 'I') {
      scene.armedAction = null;
      scene.overlay = { kind: 'inventory' };
      ev.preventDefault();
      return;
    }
    // Quickslot selection: 1..9 → slot index 0..8.
    if (ev.key.length === 1 && ev.key >= '1' && ev.key <= '9') {
      selectQuickSlot(scene, connection, ev.key.charCodeAt(0) - '1'.charCodeAt(0));
      ev.preventDefault();
      return;
    }
  });

  return state;
}
