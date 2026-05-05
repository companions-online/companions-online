// Settings screen — Music toggle (placeholder; no persistence/playback yet)
// plus a context-dependent button row at the bottom:
//   * 'main-menu' (entered from landing) → single Back button.
//   * 'in-game'   (entered via Esc during play) → Back to Game + Disconnect.
//
// The toggle's on/off state is purely closure-local in the widget. Hooking
// it up to a real audio system is a future milestone — when that lands, the
// onChange callback here is the wire-up point.

import { CANVAS_W, CANVAS_H } from '../platform/config.js';
import {
  makeBackdropDim, makeButton, makeLabel, makeToggle,
  type Widget,
} from './widgets.js';
import type { Overlay } from '../overlay.js';
import type { MenuContext, ScreenBuild } from './menu.js';

const TITLE_Y = 80;
const TOGGLE_Y = 200;
const TOGGLE_W = 320;
const TOGGLE_H = 40;

const BUTTON_W = 200;
const BUTTON_H = 44;
const BUTTON_GAP = 24;
const BUTTON_PAD = 60;

type SettingsOverlay = Extract<Overlay, { kind: 'menu'; screen: 'settings' }>;

export function buildSettingsScreen(
  ctx: MenuContext,
  overlay: SettingsOverlay,
): ScreenBuild {
  const widgets: Widget[] = [];
  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  const title = 'Settings';
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - title.length * 9,
    y: TITLE_Y,
    text: title, fontPx: 28, color: '#fff', bold: true,
  }));

  // Music toggle — pure UI placeholder. No persistence, no audio.
  widgets.push(makeToggle({
    bounds: {
      x: (CANVAS_W - TOGGLE_W) / 2,
      y: TOGGLE_Y,
      w: TOGGLE_W, h: TOGGLE_H,
    },
    label: 'Music',
    initialValue: true,
  }));

  const buttonY = CANVAS_H - BUTTON_PAD - BUTTON_H;

  if (overlay.context === 'main-menu') {
    const back = () => ctx.goTo({ kind: 'menu', screen: 'landing' });
    widgets.push(makeButton({
      bounds: {
        x: (CANVAS_W - BUTTON_W) / 2,
        y: buttonY,
        w: BUTTON_W, h: BUTTON_H,
      },
      label: 'Back',
      onClick: back,
    }));
    return { widgets, defaultAction: back, escapeAction: back };
  }

  // In-game: [Back to Game]  [Disconnect]
  const backToGame = () => ctx.goTo({ kind: 'none' });
  const disconnect = () => ctx.disconnect();

  const rowW = BUTTON_W * 2 + BUTTON_GAP;
  const rowX = (CANVAS_W - rowW) / 2;

  widgets.push(makeButton({
    bounds: { x: rowX, y: buttonY, w: BUTTON_W, h: BUTTON_H },
    label: 'Back to Game',
    onClick: backToGame,
  }));
  widgets.push(makeButton({
    bounds: { x: rowX + BUTTON_W + BUTTON_GAP, y: buttonY, w: BUTTON_W, h: BUTTON_H },
    label: 'Disconnect',
    onClick: disconnect,
  }));

  // Esc closes the in-game menu (Back to Game). Enter is intentionally
  // unwired — the user shouldn't accidentally fire Disconnect with a
  // stray Enter press.
  return { widgets, escapeAction: backToGame };
}
