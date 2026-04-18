// Keyboard controller — manages chat input mode and debug toggle.
// Attaches to the canvas element (requires tabindex="0" for focus).
// Returns a KeyboardState read by the renderer each frame.

import { ClientAction } from '@shared/actions.js';
import type { Connection } from '../network/connection.js';

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
): KeyboardState {
  const state: KeyboardState = {
    chatActive: false,
    chatBuffer: '',
    debugMode: false,
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

    // --- Not in chat mode ---
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
  });

  return state;
}
