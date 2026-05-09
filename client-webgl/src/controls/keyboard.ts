// Keyboard controller — chat input, inventory toggle, quickslot 1-9, and
// WASD-driven movement. Attaches to the canvas element (requires tabindex="0"
// for focus).
//
// WASD mapping is iso-screen-aligned: each single key picks a diagonal,
// and pressing two adjacent keys produces the cardinal between them.
//   W = NW         W+D = N         W+S, A+D = no move
//   A = SW         W+A = W
//   S = SE         S+A = S
//   D = NE         S+D = E
//
// Movement is single-tile MoveTo per step: each tick we evaluate held keys
// and either send `MoveTo(player + 1 step in dir)` or do nothing. Direction
// changes silently re-aim on the server (same-kind pendingActions
// replacement is silent — see server/src/world-actions.ts:117-125). When the
// player finishes a step and keys are still held, the next tick observes
// `currentAction !== Walking` and fires the next step.

import { ClientAction, ActionType } from '@shared/actions.js';
import { Direction, DX, DY } from '@shared/direction.js';
import type { Connection } from '../network/connection.js';
import type { Scene } from '../scene.js';
import { closeInventory } from '../ui/inventory-panel.js';
import { selectQuickSlot, clearQuickSlotSelection } from '../ui/quickslot.js';
import { isInventoryShowing, isInputCaptured } from '../overlay.js';
import { applyTurnPrediction } from './mouse.js';

const MAX_CHAT_LENGTH = 200;

export interface KeyboardState {
  /** True when the chat text input is active. */
  chatActive: boolean;
  /** Current chat input buffer. */
  chatBuffer: string;
}

export interface KeyboardControls extends KeyboardState {
  /** Per-frame driver for WASD movement. Invoked from the renderer's RAF. */
  tick(): void;
}

interface Held { w: boolean; a: boolean; s: boolean; d: boolean }

/** Map held WASD flags to an 8-way direction, or null. Each key contributes
 *  its own diagonal vector; the summed (sx, sy) is sign-clamped and looked
 *  up against shared DX/DY. */
function dirFromHeld(held: Held): Direction | null {
  // W=NW(-1,-1)  A=SW(-1,+1)  S=SE(+1,+1)  D=NE(+1,-1)
  let sx = 0;
  let sy = 0;
  if (held.w) { sx -= 1; sy -= 1; }
  if (held.a) { sx -= 1; sy += 1; }
  if (held.s) { sx += 1; sy += 1; }
  if (held.d) { sx += 1; sy -= 1; }
  sx = Math.sign(sx);
  sy = Math.sign(sy);
  if (sx === 0 && sy === 0) return null;
  for (let d = 0; d < 8; d++) {
    if (DX[d] === sx && DY[d] === sy) return d as Direction;
  }
  return null;
}

export function attachKeyboardControls(
  canvas: HTMLCanvasElement,
  connection: Connection,
  scene: Scene,
): KeyboardControls {
  const state: KeyboardState = {
    chatActive: false,
    chatBuffer: '',
  };

  const held: Held = { w: false, a: false, s: false, d: false };
  let lastCommandedDir: Direction | null = null;

  function setHeld(key: string, value: boolean): boolean {
    switch (key) {
      case 'w': case 'W': held.w = value; return true;
      case 'a': case 'A': held.a = value; return true;
      case 's': case 'S': held.s = value; return true;
      case 'd': case 'D': held.d = value; return true;
      default: return false;
    }
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
    // No inventory, no quickslot — Esc opens the in-game settings menu.
    // Earlier branches above each return on Esc, so they take priority
    // (open inventory + Esc still closes inventory, etc.).
    //
    // stopImmediatePropagation: the menu-input listener (registered after
    // this one on the same canvas) gates on `overlay.kind === 'menu'` and
    // would see the just-mutated overlay, dispatching this same Esc to the
    // menu's escapeAction — which would close the menu we just opened.
    if (ev.key === 'Escape') {
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
    // WASD held-state. Setting only fires here (chat / menu / inventory
    // branches return earlier), which keeps `held` quiescent while overlays
    // are up. Keyup is unconditional and clears `held` regardless of overlay
    // state, so a stuck key never survives an overlay close.
    if (setHeld(ev.key, true)) {
      ev.preventDefault();
      return;
    }
  });

  canvas.addEventListener('keyup', (ev) => {
    if (setHeld(ev.key, false)) {
      ev.preventDefault();
    }
  });

  // Alt-tab / focus-loss must not strand keys as held.
  canvas.addEventListener('blur', () => {
    held.w = held.a = held.s = held.d = false;
  });

  function tick(): void {
    // Gate on overlay / chat / no-player. Don't clear `held` — keyup will.
    if (state.chatActive) return;
    if (isInputCaptured(scene.overlay)) return;
    if (scene.myEntityId === null) return;

    const me = scene.entities.get(scene.myEntityId);
    if (!me?.position) return;

    const dir = dirFromHeld(held);

    if (dir === null) {
      // No keys held. The current single-tile walk (if any) finishes
      // naturally; releasing keys is implicit "stop." Reset commanded dir
      // so the next press always re-fires.
      lastCommandedDir = null;
      return;
    }

    const walking = me.currentAction?.actionType === ActionType.Walking;
    if (walking && dir === lastCommandedDir) {
      // Already walking the right way; the in-flight 1-tile MoveTo will
      // complete shortly and we'll fire again.
      return;
    }

    // Either Idle (just-arrived re-fire) or direction changed mid-walk.
    // Single-tile target = current position + 1 step in dir.
    const action = {
      action: ClientAction.MoveTo,
      tileX: me.position.tileX + DX[dir],
      tileY: me.position.tileY + DY[dir],
    };
    connection.send(action);
    applyTurnPrediction(scene, action);
    lastCommandedDir = dir;
  }

  return Object.assign(state, { tick });
}
