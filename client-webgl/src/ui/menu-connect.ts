// Connecting + connect-error screens. Both are transient states in the
// Join World flow: the user clicks Join World on create-join, we
// transition here while connectTo() is awaiting, then either close the
// menu (success) or land on connect-error (failure). Phase 5 doesn't
// expose a cancel during connecting — the 8s default timeout bounds it.

import { CANVAS_W, CANVAS_H } from '../platform/config.js';
import {
  makeBackdropDim, makeButton, makeLabel,
  type Widget,
} from './widgets.js';
import type { Overlay } from '../overlay.js';
import type { MenuContext, ScreenBuild } from './menu.js';

const TITLE_Y = 200;
const HOST_LABEL_Y = 260;
const ERROR_MESSAGE_Y = 280;

const BUTTON_Y = CANVAS_H - 160;
const BUTTON_W = 160;
const BUTTON_H = 44;
const BUTTON_GAP = 16;

export function buildConnectingScreen(ctx: MenuContext, overlay: Overlay): ScreenBuild {
  if (overlay.kind !== 'menu' || overlay.screen !== 'connecting') return { widgets: [] };
  const widgets: Widget[] = [];
  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  const title = 'Connecting…';
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - title.length * 9,
    y: TITLE_Y,
    text: title, fontPx: 28, color: '#fff', bold: true,
  }));
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - overlay.host.length * 4,
    y: HOST_LABEL_Y,
    text: overlay.host, fontPx: 14, color: '#aab',
  }));

  // Connecting is read-only — no Enter / Esc default. The connectTo
  // 8s timeout bounds the screen lifetime; manual abort is a future
  // addition (would close the WS and transition back to create-join).
  return { widgets };
}

export function buildConnectErrorScreen(ctx: MenuContext, overlay: Overlay): ScreenBuild {
  if (overlay.kind !== 'menu' || overlay.screen !== 'connect-error') return { widgets: [] };
  const widgets: Widget[] = [];
  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  const title = 'Connection Error';
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - title.length * 9,
    y: TITLE_Y,
    text: title, fontPx: 28, color: '#fff', bold: true,
  }));
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - overlay.message.length * 4,
    y: ERROR_MESSAGE_Y,
    text: overlay.message, fontPx: 14, color: '#fa6',
  }));
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - overlay.host.length * 3,
    y: ERROR_MESSAGE_Y + 30,
    text: overlay.host, fontPx: 12, color: '#aab',
  }));

  // [Back] [Retry] — paired buttons, centered as a unit.
  const totalW = BUTTON_W * 2 + BUTTON_GAP;
  const startX = (CANVAS_W - totalW) / 2;

  // Land back on create-join in join mode, preserving the user's
  // typed name / avatar / host so they can edit and retry without
  // re-entering everything.
  const back = () => ctx.goTo({
    kind: 'menu', screen: 'create-join', mode: 'join',
    values: overlay.values,
  });
  // Re-enter the join flow with the same values; main.ts's joinWorld
  // re-normalizes the host and re-issues connectTo.
  const retry = () => ctx.joinWorld(overlay.values);

  widgets.push(makeButton({
    bounds: { x: startX, y: BUTTON_Y, w: BUTTON_W, h: BUTTON_H },
    label: 'Back',
    onClick: back,
  }));

  widgets.push(makeButton({
    bounds: { x: startX + BUTTON_W + BUTTON_GAP, y: BUTTON_Y, w: BUTTON_W, h: BUTTON_H },
    label: 'Retry',
    onClick: retry,
  }));

  // Enter retries (the natural "try again" reflex), Esc backs out.
  return { widgets, defaultAction: retry, escapeAction: back };
}
