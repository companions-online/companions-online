// Create / join screen. Same layout for both modes — only the upper
// (world/server) section differs:
//
//   mode='new':  World Seed input (numeric)
//   mode='join': Remote Host input + clipboard paste icon
//
// Lower section (Character: name + avatar) and bottom bar (Back / Start
// World | Join World) are identical in both modes.
//
// Editing pattern: TextInputs hold their own value internally during
// editing; onChange writes the patch back to scene.overlay.values. The
// screen signature ignores `values`, so a per-keystroke goTo doesn't
// trigger a rebuild — focus and caret state survive every keystroke.
// Click handlers (Back, Start/Join) read scene.overlay.values to get the
// up-to-date state at submit time.

import { CANVAS_W, CANVAS_H } from '../platform/config.js';
import type { CreateJoinValues, Overlay } from '../overlay.js';
import {
  makeBackdropDim, makeButton, makeDivider, makeLabel, makeTextInput,
  type Widget, type TextInputWidget,
} from './widgets.js';
import { buildAvatarTiles } from './avatar-selector.js';
import type { MenuContext, ScreenBuild } from './menu.js';

// Form layout — centered horizontally on the canvas.
const FORM_W = 600;
const FORM_X = (CANVAS_W - FORM_W) / 2;

const TITLE_Y = 60;
const SECTION_LABEL_Y = 130;
const UPPER_INPUT_Y = 156;
const DIVIDER_Y = 230;
const CHARACTER_HEAD_Y = 254;
const NAME_LABEL_Y = 304;
const NAME_INPUT_Y = 324;
const AVATAR_LABEL_Y = 396;
const AVATAR_TILES_Y = 416;

const INPUT_H = 36;
const SEED_INPUT_W = 200;
const HOST_INPUT_W = 460;
const PASTE_BUTTON_W = 80;
const NAME_INPUT_W = 300;

const BOTTOM_BAR_Y = CANVAS_H - 100;
const BACK_W = 140;
const PRIMARY_W = 200;
const BUTTON_H = 44;

const LABEL_COLOR = '#aab';

/** Defaults supplied when a fresh create-join screen opens via the
 *  landing menu. Phase 5's connect-error → back transition restores the
 *  user's previous values; this is only used for the initial entry. */
export function defaultCreateJoinValues(servedHost: string | null): CreateJoinValues {
  return {
    name: 'Player',
    avatar: 0,
    seed: '42',
    host: servedHost ?? '',
  };
}

export function buildCreateJoinScreen(ctx: MenuContext, overlay: Overlay): ScreenBuild {
  if (overlay.kind !== 'menu' || overlay.screen !== 'create-join') return { widgets: [] };
  const mode = overlay.mode;
  const values = overlay.values;

  const widgets: Widget[] = [];

  // Mutate scene.overlay.values atomically without touching screen
  // signature (which is keyed on screen + mode only). The active widget
  // tree stays mounted, focus stays put.
  function patchValues(patch: Partial<CreateJoinValues>): void {
    const o = ctx.scene.overlay;
    if (o.kind !== 'menu' || o.screen !== 'create-join') return;
    ctx.scene.overlay = { ...o, values: { ...o.values, ...patch } };
  }

  // Track the upper input so Enter on screen entry can focus it (via
  // initialFocus on the returned ScreenBuild) and the paste handler can
  // re-focus the host input on clipboard denial.
  let upperInput: TextInputWidget | null = null;

  widgets.push(makeBackdropDim({ resolution: ctx.resolution, alpha: 0.55 }));

  const title = mode === 'new' ? 'New Game' : 'Join Game';
  widgets.push(makeLabel({
    x: CANVAS_W / 2 - title.length * 9, y: TITLE_Y,
    text: title, fontPx: 28, color: '#fff', bold: true,
  }));

  // ---- Upper section: World (new) or Server (join) ----
  if (mode === 'new') {
    widgets.push(makeLabel({
      x: FORM_X, y: SECTION_LABEL_Y,
      text: 'World Seed', fontPx: 14, color: LABEL_COLOR,
    }));
    upperInput = makeTextInput({
      bounds: { x: FORM_X, y: UPPER_INPUT_Y, w: SEED_INPUT_W, h: INPUT_H },
      initialValue: values.seed,
      numericOnly: true,
      maxLength: 10,
      onChange: (v) => patchValues({ seed: v }),
    });
    widgets.push(upperInput);
  } else {
    widgets.push(makeLabel({
      x: FORM_X, y: SECTION_LABEL_Y,
      text: 'Remote Host', fontPx: 14, color: LABEL_COLOR,
    }));
    const hostInput: TextInputWidget = makeTextInput({
      bounds: { x: FORM_X, y: UPPER_INPUT_Y, w: HOST_INPUT_W, h: INPUT_H },
      initialValue: values.host,
      placeholder: 'https://example.com',
      maxLength: 200,
      onChange: (v) => patchValues({ host: v }),
    });
    upperInput = hostInput;
    widgets.push(hostInput);
    widgets.push(makeButton({
      bounds: {
        x: FORM_X + HOST_INPUT_W + 8,
        y: UPPER_INPUT_Y,
        w: PASTE_BUTTON_W, h: INPUT_H,
      },
      label: 'Paste',
      fontPx: 14,
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) hostInput.setValue(text);
        } catch {
          // Clipboard read denied (browser policy / non-HTTPS / no user
          // gesture). Focus the host input so the user can Ctrl+V; the
          // menu controller updates focus state so the caret renders.
          ctx.focusWidget(hostInput);
        }
      },
    }));
  }

  widgets.push(makeDivider({ x: FORM_X, y: DIVIDER_Y, w: FORM_W }));

  // ---- Lower section: Character ----
  widgets.push(makeLabel({
    x: FORM_X, y: CHARACTER_HEAD_Y,
    text: 'Character', fontPx: 18, color: '#fff', bold: true,
  }));

  widgets.push(makeLabel({
    x: FORM_X, y: NAME_LABEL_Y,
    text: 'Name', fontPx: 14, color: LABEL_COLOR,
  }));
  widgets.push(makeTextInput({
    bounds: { x: FORM_X, y: NAME_INPUT_Y, w: NAME_INPUT_W, h: INPUT_H },
    initialValue: values.name,
    maxLength: 16,
    onChange: (v) => patchValues({ name: v }),
  }));

  widgets.push(makeLabel({
    x: FORM_X, y: AVATAR_LABEL_Y,
    text: 'Avatar', fontPx: 14, color: LABEL_COLOR,
  }));
  for (const tile of buildAvatarTiles({
    x: FORM_X, y: AVATAR_TILES_Y,
    selected: values.avatar,
    onSelect: (variant) => patchValues({ avatar: variant }),
    spriteRegistry: ctx.scene.spriteRegistry,
  })) widgets.push(tile);

  // ---- Bottom bar ----
  const back = () => ctx.goTo({ kind: 'menu', screen: 'landing' });
  // Read the live values from scene.overlay (the per-keystroke patches
  // written through onChange land there) rather than the closed-over
  // `values` snapshot from screen build time.
  const submit = () => {
    const o = ctx.scene.overlay;
    if (o.kind !== 'menu' || o.screen !== 'create-join') return;
    if (mode === 'new') ctx.startWorld(o.values);
    else ctx.joinWorld(o.values);
  };

  widgets.push(makeButton({
    bounds: { x: FORM_X, y: BOTTOM_BAR_Y, w: BACK_W, h: BUTTON_H },
    label: 'Back',
    onClick: back,
  }));
  widgets.push(makeButton({
    bounds: {
      x: FORM_X + FORM_W - PRIMARY_W,
      y: BOTTOM_BAR_Y,
      w: PRIMARY_W, h: BUTTON_H,
    },
    label: mode === 'new' ? 'Start World' : 'Join World',
    onClick: submit,
  }));

  return {
    widgets,
    defaultAction: submit,
    escapeAction: back,
    initialFocus: upperInput ?? undefined,
  };
}
