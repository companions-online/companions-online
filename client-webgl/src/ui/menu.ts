// Menu orchestrator — owns the active screen's widgets, focus index,
// and event routing. The screens themselves are pure widget-list factories
// in sibling files (menu-main.ts, menu-create-join.ts, menu-settings.ts).
//
// The renderer calls drawMenu(scene) once per frame when overlay.kind ===
// 'menu'. controls/menu-input.ts forwards canvas mouse + key events here.
//
// Lifecycle: when scene.overlay changes screen (or the menu opens for the
// first time), we dispose the prior widget list and rebuild from the
// active screen's factory. Closing the menu (overlay.kind = 'none')
// disposes everything.

import type { Scene } from '../scene.js';
import type { Overlay, CreateJoinValues } from '../overlay.js';
import type { TextSurfaceFactory } from '../effects/text-surface.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { WidgetPalette } from './widget-palette.js';
import {
  type Widget,
  type DrawCtx,
  type KeyEvent,
} from './widgets.js';
import type { MenuLogo } from './logo.js';
import { buildLandingScreen } from './menu-main.js';
import { buildSettingsScreen } from './menu-settings.js';
import { buildCreateJoinScreen } from './menu-create-join.js';
import { buildConnectingScreen, buildConnectErrorScreen } from './menu-connect.js';

/** Ambient context passed to every screen factory. Click handlers reach
 *  the orchestrator (transitions, close, openUrl) through this. */
export interface MenuContext {
  scene: Scene;
  palette: WidgetPalette;
  logo: MenuLogo;
  resolution: () => readonly [number, number];
  /** Host string injected as window.GAME_SERVER_HOST, or null when
   *  running standalone. Auto-fills the create-join Remote Host input. */
  servedHost: string | null;
  /** Replace scene.overlay. Triggers screen rebuild on next draw. */
  goTo(overlay: Overlay): void;
  /** Close the menu without starting a game. Currently unused — Start
   *  World / Join World handlers close the menu themselves as part of
   *  the boot sequence. Reserved for future "skip" / dev-shortcut paths. */
  close(): void;
  openUrl(url: string): void;
  /** "Start World" submission from create-join (mode='new'). main.ts
   *  tears down the observer, boots a fresh in-tab world with the
   *  chosen seed, applies the chosen name + avatar, and dismisses
   *  the menu. */
  startWorld(values: CreateJoinValues): void;
  /** "Join World" submission from create-join (mode='join'). Phase 5. */
  joinWorld(values: CreateJoinValues): void;
  /** Make `target` the focused widget on the active screen. No-op if
   *  the widget isn't focusable or isn't in the active screen. Used by
   *  the create-join paste button to focus the host input when the
   *  clipboard read is denied. */
  focusWidget(target: Widget): void;
}

/** Result of a screen factory. The orchestrator consumes the widget
 *  list plus optional Enter / Esc / initial-focus hooks. Returning a
 *  bare Widget[] from a factory is also accepted via the
 *  `widgetsToScreen` adapter — convenient for screens with no defaults
 *  (landing, connecting). */
export interface ScreenBuild {
  widgets: Widget[];
  /** Triggered on Enter when no focused widget consumed the key. */
  defaultAction?: () => void;
  /** Triggered on Esc when no focused widget consumed the key. */
  escapeAction?: () => void;
  /** Widget to focus on screen entry. Defaults to the first focusable
   *  widget (or no focus if none are focusable). */
  initialFocus?: Widget;
}

interface ActiveScreen {
  /** Cached overlay snapshot — cheap shallow-equality check decides rebuild. */
  signature: string;
  widgets: Widget[];
  focusable: number[];
  focusIndex: number;
  defaultAction?: () => void;
  escapeAction?: () => void;
}

export interface MenuController {
  draw(scene: Scene): void;
  onMouseMove(x: number, y: number): void;
  onMouseDown(x: number, y: number): void;
  onMouseUp(x: number, y: number): void;
  /** True when the key was consumed. */
  onKey(ev: KeyEvent): boolean;
  /** Drop all cached widgets (release surfaces). Safe to call repeatedly. */
  dispose(): void;
}

interface MouseState { x: number; y: number; down: boolean }

export interface CreateMenuOpts {
  scene: Scene;
  palette: WidgetPalette;
  logo: MenuLogo;
  spriteRenderer: SpriteRenderer;
  factory: TextSurfaceFactory;
  servedHost: string | null;
  resolution: () => readonly [number, number];
  /** Hook for game-start once a screen wants to close the menu. Phase 2
   *  passes a no-op; Phase 4/5 plumbs real behavior. */
  onClose?: () => void;
  onStartWorld?: (values: CreateJoinValues) => void;
  onJoinWorld?: (values: CreateJoinValues) => void;
}

export function createMenuController(opts: CreateMenuOpts): MenuController {
  const mouse: MouseState = { x: 0, y: 0, down: false };
  let active: ActiveScreen | null = null;

  const ctx: MenuContext = {
    scene: opts.scene,
    palette: opts.palette,
    logo: opts.logo,
    resolution: opts.resolution,
    servedHost: opts.servedHost,
    goTo(overlay) { opts.scene.overlay = overlay; },
    close() {
      opts.scene.overlay = { kind: 'none' };
      opts.onClose?.();
    },
    openUrl(url) { window.open(url, '_blank', 'noopener'); },
    startWorld(values) { opts.onStartWorld?.(values); },
    joinWorld(values) { opts.onJoinWorld?.(values); },
    focusWidget(target) {
      if (!active) return;
      const widgetIdx = active.widgets.indexOf(target);
      if (widgetIdx === -1) return;
      const focIdx = active.focusable.indexOf(widgetIdx);
      if (focIdx === -1) return;
      if (active.focusIndex === focIdx) return;
      if (active.focusIndex >= 0) {
        active.widgets[active.focusable[active.focusIndex]].setFocus?.(false);
      }
      active.focusIndex = focIdx;
      target.setFocus?.(true);
    },
  };

  // Screen signature decides when to rebuild widgets. `screen` alone
  // misses mode changes within create-join (new ↔ join differ in their
  // upper section); `values` is intentionally NOT included so per-
  // keystroke patches don't trigger rebuilds. Connecting/connect-error
  // include host (and message, for connect-error) since their text
  // content is part of the visible state — a different host or error
  // means different rendered widgets.
  function overlaySignature(o: Overlay): string {
    if (o.kind !== 'menu') return o.kind;
    if (o.screen === 'create-join') return `menu:create-join:${o.mode}`;
    if (o.screen === 'connecting') return `menu:connecting:${o.host}`;
    if (o.screen === 'connect-error') return `menu:connect-error:${o.host}|${o.message}`;
    return `menu:${o.screen}`;
  }

  function buildScreen(overlay: Overlay): ActiveScreen {
    const build = buildScreenWidgets(overlay, ctx);
    const widgets = build.widgets;
    const focusable: number[] = [];
    for (let i = 0; i < widgets.length; i++) {
      if (widgets[i].isFocusable?.()) focusable.push(i);
    }
    let focusIndex = focusable.length > 0 ? 0 : -1;
    if (build.initialFocus) {
      const widgetIdx = widgets.indexOf(build.initialFocus);
      const focIdx = widgetIdx >= 0 ? focusable.indexOf(widgetIdx) : -1;
      if (focIdx >= 0) focusIndex = focIdx;
    }
    return {
      signature: overlaySignature(overlay),
      widgets,
      focusable,
      focusIndex,
      defaultAction: build.defaultAction,
      escapeAction: build.escapeAction,
    };
  }

  function disposeActive(): void {
    if (!active) return;
    for (const w of active.widgets) w.dispose(opts.factory);
    active = null;
  }

  function ensureScreen(): ActiveScreen | null {
    const overlay = opts.scene.overlay;
    if (overlay.kind !== 'menu') {
      disposeActive();
      return null;
    }
    const sig = overlaySignature(overlay);
    if (!active || active.signature !== sig) {
      disposeActive();
      active = buildScreen(overlay);
      // Auto-focus on screen entry — uses the build's initialFocus
      // when supplied, else the first focusable widget.
      if (active.focusIndex >= 0) {
        active.widgets[active.focusable[active.focusIndex]].setFocus?.(true);
      }
    }
    return active;
  }

  return {
    draw(scene) {
      const screen = ensureScreen();
      if (!screen) return;
      // Native HUD resolution — same coord space as drawHud, so widget
      // positions are canvas pixels.
      const [w, h] = opts.resolution();
      opts.spriteRenderer.begin([w, h]);
      const drawCtx: DrawCtx = {
        gl: scene.gl,
        sprites: opts.spriteRenderer,
        factory: opts.factory,
        palette: opts.palette,
        mouseX: mouse.x,
        mouseY: mouse.y,
        mouseDown: mouse.down,
        now: scene.time,
      };
      for (const wgt of screen.widgets) wgt.draw(drawCtx);
      opts.spriteRenderer.end();
    },

    onMouseMove(x, y) {
      mouse.x = x;
      mouse.y = y;
    },

    onMouseDown(x, y) {
      mouse.x = x; mouse.y = y; mouse.down = true;
      const screen = ensureScreen();
      if (!screen) return;

      // Promote focus to the focusable widget under the cursor (if any).
      // Click-on-empty-space clears focus from the prior widget so
      // the caret stops blinking when the user is no longer editing.
      let clickedFocusable = -1;
      for (let i = 0; i < screen.widgets.length; i++) {
        const w = screen.widgets[i];
        if (w.isFocusable?.() && w.hitTest(x, y)) {
          clickedFocusable = screen.focusable.indexOf(i);
          break;
        }
      }
      if (clickedFocusable !== -1 && screen.focusIndex !== clickedFocusable) {
        if (screen.focusIndex >= 0) {
          screen.widgets[screen.focusable[screen.focusIndex]].setFocus?.(false);
        }
        screen.focusIndex = clickedFocusable;
        screen.widgets[screen.focusable[clickedFocusable]].setFocus?.(true);
      }

      for (const w of screen.widgets) w.onMouseDown?.(x, y);
    },

    onMouseUp(x, y) {
      mouse.x = x; mouse.y = y; mouse.down = false;
      const screen = ensureScreen();
      if (!screen) return;
      for (const w of screen.widgets) w.onMouseUp?.(x, y);
    },

    onKey(ev) {
      const screen = ensureScreen();
      if (!screen) return false;

      // Focused widget gets first crack — TextInputs absorb printables /
      // Backspace / Enter (Enter calls their onSubmit, which we leave
      // unwired by default so the screen-level defaultAction fires below).
      if (screen.focusIndex >= 0) {
        const w = screen.widgets[screen.focusable[screen.focusIndex]];
        if (w.onKey?.(ev)) return true;
      }

      if (ev.key === 'Enter' && screen.defaultAction) {
        screen.defaultAction();
        return true;
      }
      if (ev.key === 'Escape' && screen.escapeAction) {
        screen.escapeAction();
        return true;
      }

      return false;
    },

    dispose() {
      disposeActive();
    },
  };
}

// ---------------------------------------------------------------------------
// Screen dispatch — extend this when Phase 3 adds real settings/create-join.
// Keeping the dispatch in one switch makes the screen catalog discoverable
// and avoids a registry indirection nobody asked for.
// ---------------------------------------------------------------------------

function buildScreenWidgets(overlay: Overlay, ctx: MenuContext): ScreenBuild {
  if (overlay.kind !== 'menu') return { widgets: [] };
  switch (overlay.screen) {
    case 'landing':       return buildLandingScreen(ctx);
    case 'settings':      return buildSettingsScreen(ctx);
    case 'create-join':   return buildCreateJoinScreen(ctx, overlay);
    case 'connecting':    return buildConnectingScreen(ctx, overlay);
    case 'connect-error': return buildConnectErrorScreen(ctx, overlay);
  }
}
