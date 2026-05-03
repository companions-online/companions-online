// Settings screen — placeholder. Real settings (audio/video/controls)
// land later; this milestone treats it as out of scope per planning,
// so the screen is just a title and a Back button.

import { CANVAS_W, CANVAS_H } from '../platform/config.js';
import {
  makeBackdropDim, makeButton, makeLabel,
  type Widget,
} from './widgets.js';
import type { MenuContext, ScreenBuild } from './menu.js';

const TITLE_Y = 80;
const BACK_W = 160;
const BACK_H = 44;
const BACK_PAD = 60;

export function buildSettingsScreen(ctx: MenuContext): ScreenBuild {
  const widgets: Widget[] = [];
  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  const title = 'Settings';
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - title.length * 9,
    y: TITLE_Y,
    text: title, fontPx: 28, color: '#fff', bold: true,
  }));

  const back = () => ctx.goTo({ kind: 'menu', screen: 'landing' });

  widgets.push(makeButton({
    bounds: {
      x: (CANVAS_W - BACK_W) / 2,
      y: CANVAS_H - BACK_PAD - BACK_H,
      w: BACK_W, h: BACK_H,
    },
    label: 'Back',
    onClick: back,
  }));

  // Enter and Esc both fire Back — settings has nothing else to do.
  return { widgets, defaultAction: back, escapeAction: back };
}
