// Landing screen — logo + mode-aware buttons + footer link + build version.
//
// Layout is hand-positioned over the canvas resolution:
//   * Logo top-center, max width clamped, aspect preserved
//   * Vertical stack of buttons centered horizontally, around the middle
//     of the canvas (3 buttons standalone, 2 buttons server-served)
//   * Footer-left: companions-online.github.io as a chrome-less link button
//   * Footer-right: `build NNN` as a label
//
// Stub click handlers transition to settings/create-join via the
// MenuContext.goTo callback. Those screens are placeholder shells in
// Phase 2 — full content lands in Phase 3.

import { CANVAS_W, CANVAS_H } from '../platform/config.js';
import {
  makeButton, makeImage, makeLabel, makeBackdropDim,
  type Widget,
} from './widgets.js';
import { defaultCreateJoinValues } from './menu-create-join.js';
import type { MenuContext, ScreenBuild } from './menu.js';

const LOGO_MAX_W = 480;
const LOGO_TOP_Y = 60;

const BUTTON_W = 260;
const BUTTON_H = 48;
const BUTTON_GAP = 16;
/** Top of the button stack — keeps the logo + button stack visually separated. */
const BUTTON_STACK_Y = 360;

const FOOTER_PAD = 16;
const FOOTER_FONT_PX = 12;

const HOMEPAGE_URL = 'https://companions-online.github.io';

function buildVersionLabel(): string {
  const v = (typeof __BUILD_VERSION__ !== 'undefined') ? __BUILD_VERSION__ : 0;
  return `build ${v}`;
}

function logoBounds(width: number, height: number) {
  const w = Math.min(width, LOGO_MAX_W);
  const h = (height / width) * w;
  const x = (CANVAS_W - w) / 2;
  return { x, y: LOGO_TOP_Y, w, h };
}

export function buildLandingScreen(ctx: MenuContext): ScreenBuild {
  const widgets: Widget[] = [];

  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  widgets.push(makeImage({
    bounds: logoBounds(ctx.logo.width, ctx.logo.height),
    texture: ctx.logo.texture,
  }));

  // Three-button stack in both standalone and server-served modes.
  // New Game always boots an in-tab world from the chosen seed; Join
  // Game dials the remote (autofilled with servedHost when present).
  const buttons: { label: string; onClick: () => void }[] = [
    {
      label: 'New Game',
      onClick: () => ctx.goTo({
        kind: 'menu', screen: 'create-join', mode: 'new',
        values: defaultCreateJoinValues(ctx.servedHost),
      }),
    },
    {
      label: 'Join Game',
      onClick: () => ctx.goTo({
        kind: 'menu', screen: 'create-join', mode: 'join',
        values: defaultCreateJoinValues(ctx.servedHost),
      }),
    },
    {
      label: 'Settings',
      onClick: () => ctx.goTo({ kind: 'menu', screen: 'settings' }),
    },
  ];

  for (let i = 0; i < buttons.length; i++) {
    const y = BUTTON_STACK_Y + i * (BUTTON_H + BUTTON_GAP);
    const x = (CANVAS_W - BUTTON_W) / 2;
    widgets.push(makeButton({
      bounds: { x, y, w: BUTTON_W, h: BUTTON_H },
      label: buttons[i].label,
      onClick: buttons[i].onClick,
    }));
  }

  // Footer-left link. Chrome-less so the label reads as plain text with
  // a hover underline. Bounds are populated on first draw.
  widgets.push(makeButton({
    bounds: { x: FOOTER_PAD, y: CANVAS_H - FOOTER_PAD - FOOTER_FONT_PX - 6, w: 220, h: FOOTER_FONT_PX + 6 },
    label: HOMEPAGE_URL.replace('https://', ''),
    onClick: () => ctx.openUrl(HOMEPAGE_URL),
    chromeless: true,
    fontPx: FOOTER_FONT_PX,
    labelColor: '#aab',
  }));

  // Footer-right build version. Right-aligned via the makeLabel x parameter
  // — first-draw measures the surface width, then we shift the label.
  // Easier: a chrome-less, non-clickable button-shaped widget at the right edge
  // doesn't quite fit (button centers its label). makeLabel placed near the
  // right with manual x — it'll be slightly off if the build digit count
  // changes, but at three-digit range it stays inside footer-right.
  const versionText = buildVersionLabel();
  // Approximate width: ~7px per char at 12pt sans. Refined post-draw if needed,
  // but for "build NNN" this lands within ±10px of right-aligned.
  const approxW = versionText.length * 7;
  widgets.push(makeLabel({
    x: CANVAS_W - FOOTER_PAD - approxW,
    y: CANVAS_H - FOOTER_PAD - FOOTER_FONT_PX,
    text: versionText,
    color: '#aab',
    fontPx: FOOTER_FONT_PX,
  }));

  // Landing has no Enter / Esc default — the user has to pick a button.
  return { widgets };
}
