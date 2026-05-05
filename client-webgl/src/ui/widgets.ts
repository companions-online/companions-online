// Canvas-native widget kit for the main menu (and any future modal UI).
//
// Three primitives in this codebase produce all menu chrome:
//   * solid-color quad (bind a 1×1 texture from WidgetPalette + drawSprite)
//   * rasterized text (TextSurfaceFactory + drawSprite)
//   * image (loaded sprite + drawSprite)
//
// Widgets are closure factories returning a Widget; state (hover/pressed/
// focus/value/cached TextSurface) lives in the closure. Matches the
// codebase's createScene/createRenderer/createTextSurfaceFactory idiom.
//
// Lifecycle: a Screen is just Widget[]. The orchestrator drives:
//   * draw — once per frame, with a populated DrawCtx
//   * mouse / key dispatch — orchestrator hit-tests + routes
//   * focus — orchestrator tracks the focused widget index per screen,
//     calls setFocus(true/false) on transitions
//   * dispose(factory) — called on screen tear-down to release cached
//     TextSurfaces back into the factory's refcounted cache
//
// The widget kit doesn't know about screens — Phase 2 (menu.ts) plumbs
// these together.

import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import type { WidgetPalette } from './widget-palette.js';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawCtx {
  gl: WebGL2RenderingContext;
  sprites: SpriteRenderer;
  factory: TextSurfaceFactory;
  palette: WidgetPalette;
  /** Cursor position in canvas-pixel space. Used for hover state. */
  mouseX: number;
  mouseY: number;
  /** True while a mouse button is held — affects pressed state visuals. */
  mouseDown: boolean;
  /** Wall-clock ms (Date.now or performance.now); used for caret blink. */
  now: number;
}

/** Stripped-down KeyboardEvent shape — easier to synthesize in tests. */
export interface KeyEvent {
  key: string;
  preventDefault?: () => void;
}

export interface Widget {
  bounds: Bounds;
  draw(ctx: DrawCtx): void;
  /** Return true if (x, y) is inside the widget's interactive region. */
  hitTest(x: number, y: number): boolean;
  /** Mouse-button-down at (x, y). Widget records armed state here. */
  onMouseDown?(x: number, y: number): void;
  /** Mouse-button-up at (x, y). Click fires here when armed + still inside. */
  onMouseUp?(x: number, y: number): void;
  /** Returns true if the key was consumed (orchestrator stops bubbling). */
  onKey?(ev: KeyEvent): boolean;
  isFocusable?(): boolean;
  setFocus?(focused: boolean): void;
  /** Release any cached TextSurfaces. Safe to call before first draw. */
  dispose(factory: TextSurfaceFactory): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pointInBounds(b: Bounds, x: number, y: number): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

function drawSolidQuad(
  ctx: DrawCtx,
  texture: WebGLTexture,
  x: number, y: number, w: number, h: number,
): void {
  ctx.gl.activeTexture(ctx.gl.TEXTURE0);
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, texture);
  ctx.sprites.drawSprite(x, y, w, h, 0, 0, 1, 1);
}

function drawBorder(
  ctx: DrawCtx,
  b: Bounds,
  thickness: number,
  texture: WebGLTexture,
): void {
  drawSolidQuad(ctx, texture, b.x, b.y, b.w, thickness);
  drawSolidQuad(ctx, texture, b.x, b.y + b.h - thickness, b.w, thickness);
  drawSolidQuad(ctx, texture, b.x, b.y, thickness, b.h);
  drawSolidQuad(ctx, texture, b.x + b.w - thickness, b.y, thickness, b.h);
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonOpts {
  bounds: Bounds;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  fontPx?: number;
  /** Suppress the bg + border quads. Used for chrome-less link buttons. */
  chromeless?: boolean;
  /** Override label color (default '#fff', or '#888' when disabled). */
  labelColor?: string;
}

export function makeButton(opts: ButtonOpts): Widget {
  let armed = false;
  let labelSurface: TextSurface | null = null;
  let cachedKey = '';
  const fontPx = opts.fontPx ?? 16;

  const bounds = opts.bounds;
  const inBounds = (x: number, y: number) => pointInBounds(bounds, x, y);

  return {
    bounds,
    hitTest: inBounds,
    draw(ctx) {
      const hovered = inBounds(ctx.mouseX, ctx.mouseY);

      if (!opts.chromeless) {
        const bg = opts.disabled
          ? ctx.palette.bgPressed
          : (armed && ctx.mouseDown && hovered)
            ? ctx.palette.bgPressed
            : hovered
              ? ctx.palette.bgHover
              : ctx.palette.bg;
        drawSolidQuad(ctx, bg, bounds.x, bounds.y, bounds.w, bounds.h);
        drawBorder(ctx, bounds, 1, ctx.palette.border);
      }

      const color = opts.labelColor ?? (opts.disabled ? '#888' : '#fff');
      // Chrome-less buttons indicate hover with bracket adornments around
      // the label rather than the bg/border affordance regular buttons use.
      // The label-cache key includes the bracketed form so the surface
      // rebuilds on hover transitions; the factory's content-keyed cache
      // makes the toggle cheap on repeated hover/unhover.
      const labelText = (opts.chromeless && hovered && !opts.disabled)
        ? `[ ${opts.label} ]`
        : opts.label;
      const key = `${labelText}|${color}|${fontPx}|${opts.chromeless ? 'u' : ''}`;
      if (cachedKey !== key || !labelSurface) {
        if (labelSurface) ctx.factory.release(labelSurface);
        labelSurface = ctx.factory.create({
          text: labelText,
          fillColor: color,
          fontPx,
          bold: !opts.chromeless,
        });
        cachedKey = key;
      }
      const surface: TextSurface = labelSurface;

      const lx = bounds.x + (bounds.w - surface.width) / 2;
      const ly = bounds.y + (bounds.h - surface.height) / 2;
      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, surface.texture);
      ctx.sprites.drawSprite(lx, ly, surface.width, surface.height, 0, 0, 1, 1);
    },
    onMouseDown(x, y) {
      if (opts.disabled) return;
      if (inBounds(x, y)) armed = true;
    },
    onMouseUp(x, y) {
      if (!opts.disabled && armed && inBounds(x, y)) opts.onClick();
      armed = false;
    },
    dispose(factory) {
      if (labelSurface) factory.release(labelSurface);
      labelSurface = null;
      cachedKey = '';
    },
  };
}

// ---------------------------------------------------------------------------
// Toggle — focusable on/off control. Label on the left, pill on the right.
// State is closure-local; no persistence. Mirrors makeButton's armed/hover
// pattern for click affordance; Space and Enter toggle when focused.
// ---------------------------------------------------------------------------

export interface ToggleOpts {
  bounds: Bounds;
  label: string;
  initialValue: boolean;
  onChange?(next: boolean): void;
  fontPx?: number;
}

const TOGGLE_PILL_W = 44;
const TOGGLE_PILL_H = 22;
const TOGGLE_KNOB_INSET = 3;
const TOGGLE_LABEL_PAD = 12;

export function makeToggle(opts: ToggleOpts): Widget {
  let value = opts.initialValue;
  let armed = false;
  let focused = false;
  let labelSurface: TextSurface | null = null;
  let cachedKey = '';
  const fontPx = opts.fontPx ?? 16;
  const bounds = opts.bounds;
  const inBounds = (x: number, y: number) => pointInBounds(bounds, x, y);

  function flip(): void {
    value = !value;
    opts.onChange?.(value);
  }

  return {
    bounds,
    hitTest: inBounds,
    isFocusable: () => true,
    setFocus(f) { focused = f; },
    draw(ctx) {
      // Label
      const key = `${opts.label}|${fontPx}`;
      if (cachedKey !== key || !labelSurface) {
        if (labelSurface) ctx.factory.release(labelSurface);
        labelSurface = ctx.factory.create({
          text: opts.label, fillColor: '#fff', fontPx,
        });
        cachedKey = key;
      }
      const surface: TextSurface = labelSurface;
      const ly = bounds.y + (bounds.h - surface.height) / 2;
      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, surface.texture);
      ctx.sprites.drawSprite(
        bounds.x + TOGGLE_LABEL_PAD, ly,
        surface.width, surface.height, 0, 0, 1, 1,
      );

      // Pill — right-aligned inside bounds.
      const pillX = bounds.x + bounds.w - TOGGLE_PILL_W - TOGGLE_LABEL_PAD;
      const pillY = bounds.y + (bounds.h - TOGGLE_PILL_H) / 2;
      const pillBg = value ? ctx.palette.accent : ctx.palette.bgPressed;
      drawSolidQuad(ctx, pillBg, pillX, pillY, TOGGLE_PILL_W, TOGGLE_PILL_H);
      drawBorder(
        ctx,
        { x: pillX, y: pillY, w: TOGGLE_PILL_W, h: TOGGLE_PILL_H },
        focused ? 2 : 1,
        focused ? ctx.palette.accent : ctx.palette.border,
      );

      // Knob — slides between left and right ends of the pill.
      const knobSize = TOGGLE_PILL_H - TOGGLE_KNOB_INSET * 2;
      const knobX = value
        ? pillX + TOGGLE_PILL_W - TOGGLE_KNOB_INSET - knobSize
        : pillX + TOGGLE_KNOB_INSET;
      drawSolidQuad(
        ctx, ctx.palette.bg,
        knobX, pillY + TOGGLE_KNOB_INSET, knobSize, knobSize,
      );
    },
    onMouseDown(x, y) { if (inBounds(x, y)) armed = true; },
    onMouseUp(x, y) {
      if (armed && inBounds(x, y)) flip();
      armed = false;
    },
    onKey(ev) {
      if (!focused) return false;
      if (ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Enter') {
        flip();
        return true;
      }
      return false;
    },
    dispose(factory) {
      if (labelSurface) factory.release(labelSurface);
      labelSurface = null;
      cachedKey = '';
    },
  };
}

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

export interface TextInputOpts {
  bounds: Bounds;
  initialValue: string;
  onChange?(value: string): void;
  onSubmit?(): void;
  placeholder?: string;
  /** Restrict input to digits 0-9. Backspace + Enter still work. */
  numericOnly?: boolean;
  maxLength?: number;
  fontPx?: number;
}

/** A TextInput is a Widget plus imperative get/set hooks so adjacent UI
 *  (paste buttons, validators) can read or replace the current value
 *  without forcing a full screen rebuild. */
export interface TextInputWidget extends Widget {
  getValue(): string;
  setValue(value: string): void;
}

const TEXT_INPUT_PAD = 6;

export function makeTextInput(opts: TextInputOpts): TextInputWidget {
  let value = opts.initialValue;
  let focused = false;
  let valueSurface: TextSurface | null = null;
  let cachedKey = '';
  let placeholderSurface: TextSurface | null = null;
  let cachedPlaceholderKey = '';
  const fontPx = opts.fontPx ?? 14;

  const bounds = opts.bounds;
  const inBounds = (x: number, y: number) => pointInBounds(bounds, x, y);

  function rebuildValueSurface(ctx: DrawCtx): void {
    const key = value === '' ? '' : `${value}|${fontPx}`;
    if (cachedKey === key) return;
    if (valueSurface) ctx.factory.release(valueSurface);
    valueSurface = value === ''
      ? null
      : ctx.factory.create({ text: value, fillColor: '#fff', fontPx });
    cachedKey = key;
  }

  function rebuildPlaceholder(ctx: DrawCtx): void {
    if (!opts.placeholder) return;
    const key = `${opts.placeholder}|${fontPx}`;
    if (cachedPlaceholderKey === key) return;
    if (placeholderSurface) ctx.factory.release(placeholderSurface);
    placeholderSurface = ctx.factory.create({
      text: opts.placeholder, fillColor: '#666', fontPx,
    });
    cachedPlaceholderKey = key;
  }

  return {
    bounds,
    hitTest: inBounds,
    isFocusable: () => true,
    setFocus(f) { focused = f; },
    draw(ctx) {
      drawSolidQuad(ctx, ctx.palette.inputBg, bounds.x, bounds.y, bounds.w, bounds.h);
      drawBorder(
        ctx, bounds, focused ? 2 : 1,
        focused ? ctx.palette.accent : ctx.palette.border,
      );

      rebuildValueSurface(ctx);
      const showPlaceholder = value === '' && !!opts.placeholder;
      if (showPlaceholder) {
        rebuildPlaceholder(ctx);
        if (placeholderSurface) {
          const py = bounds.y + (bounds.h - placeholderSurface.height) / 2;
          ctx.gl.activeTexture(ctx.gl.TEXTURE0);
          ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, placeholderSurface.texture);
          ctx.sprites.drawSprite(
            bounds.x + TEXT_INPUT_PAD, py,
            placeholderSurface.width, placeholderSurface.height, 0, 0, 1, 1,
          );
        }
      } else if (valueSurface) {
        const ty = bounds.y + (bounds.h - valueSurface.height) / 2;
        ctx.gl.activeTexture(ctx.gl.TEXTURE0);
        ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, valueSurface.texture);
        ctx.sprites.drawSprite(
          bounds.x + TEXT_INPUT_PAD, ty,
          valueSurface.width, valueSurface.height, 0, 0, 1, 1,
        );
      }

      if (focused && (ctx.now % 1000) < 500) {
        const caretX = bounds.x + TEXT_INPUT_PAD + (valueSurface?.width ?? 0);
        drawSolidQuad(
          ctx, ctx.palette.accent,
          caretX, bounds.y + 4, 1, bounds.h - 8,
        );
      }
    },
    onKey(ev) {
      if (!focused) return false;
      if (ev.key === 'Backspace') {
        if (value.length === 0) return true;
        value = value.slice(0, -1);
        opts.onChange?.(value);
        return true;
      }
      if (ev.key === 'Enter') {
        if (opts.onSubmit) {
          opts.onSubmit();
          return true;
        }
        // Bubble Enter to the menu controller so the screen's default
        // button (Start World / Join World / Retry / Back) can fire.
        return false;
      }
      // Esc bubbles too — screen-level Back lives at the controller.
      if (ev.key === 'Escape') return false;
      // Single printable character.
      if (ev.key.length === 1 && ev.key.charCodeAt(0) >= 0x20) {
        if (opts.numericOnly && !/^\d$/.test(ev.key)) return true;
        if (opts.maxLength !== undefined && value.length >= opts.maxLength) return true;
        value += ev.key;
        opts.onChange?.(value);
        return true;
      }
      return false;
    },
    dispose(factory) {
      if (valueSurface) factory.release(valueSurface);
      if (placeholderSurface) factory.release(placeholderSurface);
      valueSurface = null;
      placeholderSurface = null;
      cachedKey = '';
      cachedPlaceholderKey = '';
    },
    getValue() { return value; },
    setValue(v) {
      if (opts.maxLength !== undefined && v.length > opts.maxLength) {
        v = v.slice(0, opts.maxLength);
      }
      value = v;
      opts.onChange?.(v);
    },
  };
}

// ---------------------------------------------------------------------------
// Label — non-interactive text. Hit-tests false unless onClick is supplied.
// Bounds populate after first draw (text width/height come from rasterization).
// ---------------------------------------------------------------------------

export interface LabelOpts {
  x: number;
  y: number;
  text: string;
  color?: string;
  fontPx?: number;
  outlineColor?: string;
  bold?: boolean;
  /** When set, the label hit-tests its bounds and fires onClick on mouseup. */
  onClick?: () => void;
}

export function makeLabel(opts: LabelOpts): Widget {
  let surface: TextSurface | null = null;
  let cachedKey = '';
  const fontPx = opts.fontPx ?? 14;
  const bounds: Bounds = { x: opts.x, y: opts.y, w: 0, h: 0 };
  let armed = false;

  const inBounds = (x: number, y: number) =>
    bounds.w > 0 && pointInBounds(bounds, x, y);

  function rebuild(ctx: DrawCtx): void {
    const color = opts.color ?? '#fff';
    const key = `${opts.text}|${color}|${opts.outlineColor ?? ''}|${fontPx}|${opts.bold ? 1 : 0}`;
    if (cachedKey === key && surface) return;
    if (surface) ctx.factory.release(surface);
    surface = ctx.factory.create({
      text: opts.text,
      fillColor: color,
      outlineColor: opts.outlineColor,
      fontPx,
      bold: opts.bold,
    });
    cachedKey = key;
    bounds.w = surface.width;
    bounds.h = surface.height;
  }

  return {
    bounds,
    hitTest: opts.onClick ? inBounds : () => false,
    draw(ctx) {
      rebuild(ctx);
      if (!surface) return;
      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, surface.texture);
      ctx.sprites.drawSprite(bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, 1, 1);
    },
    onMouseDown(x, y) {
      if (opts.onClick && inBounds(x, y)) armed = true;
    },
    onMouseUp(x, y) {
      if (opts.onClick && armed && inBounds(x, y)) opts.onClick();
      armed = false;
    },
    dispose(factory) {
      if (surface) factory.release(surface);
      surface = null;
      cachedKey = '';
    },
  };
}

// ---------------------------------------------------------------------------
// Divider — thin horizontal line. Non-interactive.
// ---------------------------------------------------------------------------

export interface DividerOpts {
  x: number;
  y: number;
  w: number;
  thickness?: number;
}

export function makeDivider(opts: DividerOpts): Widget {
  const thickness = opts.thickness ?? 1;
  const bounds: Bounds = { x: opts.x, y: opts.y, w: opts.w, h: thickness };
  return {
    bounds,
    hitTest: () => false,
    draw(ctx) {
      drawSolidQuad(ctx, ctx.palette.border, bounds.x, bounds.y, bounds.w, bounds.h);
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// Image — show a sprite/texture at given bounds. Non-interactive.
// ---------------------------------------------------------------------------

export interface ImageOpts {
  bounds: Bounds;
  texture: WebGLTexture;
  /** Source-UV rect (0..1). Defaults to the full texture. */
  srcU?: number;
  srcV?: number;
  srcDU?: number;
  srcDV?: number;
}

export function makeImage(opts: ImageOpts): Widget {
  return {
    bounds: opts.bounds,
    hitTest: () => false,
    draw(ctx) {
      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, opts.texture);
      ctx.sprites.drawSprite(
        opts.bounds.x, opts.bounds.y, opts.bounds.w, opts.bounds.h,
        opts.srcU ?? 0, opts.srcV ?? 0, opts.srcDU ?? 1, opts.srcDV ?? 1,
      );
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// SelectableTile — square tile showing a sprite frame, with hover/selection
// affordance. The avatar selector is the current consumer; any future
// tile-pick UI (variant pickers, equip layouts) can reuse this primitive.
// ---------------------------------------------------------------------------

export interface SelectableTileOpts {
  bounds: Bounds;
  texture: WebGLTexture;
  /** Source-UV rect (0..1). Defaults to the full texture. */
  srcU?: number;
  srcV?: number;
  srcDU?: number;
  srcDV?: number;
  selected: boolean;
  onClick: () => void;
  /** Inset around the sprite, in pixels. Default 6. */
  inset?: number;
}

export function makeSelectableTile(opts: SelectableTileOpts): Widget {
  let armed = false;
  const bounds = opts.bounds;
  const inset = opts.inset ?? 6;
  const inB = (x: number, y: number) => pointInBounds(bounds, x, y);

  return {
    bounds,
    hitTest: inB,
    draw(ctx) {
      const hovered = inB(ctx.mouseX, ctx.mouseY);
      const bg = (opts.selected || hovered) ? ctx.palette.bgHover : ctx.palette.bg;
      drawSolidQuad(ctx, bg, bounds.x, bounds.y, bounds.w, bounds.h);

      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, opts.texture);
      ctx.sprites.drawSprite(
        bounds.x + inset, bounds.y + inset,
        bounds.w - inset * 2, bounds.h - inset * 2,
        opts.srcU ?? 0, opts.srcV ?? 0, opts.srcDU ?? 1, opts.srcDV ?? 1,
      );

      drawBorder(
        ctx, bounds,
        opts.selected ? 3 : 1,
        opts.selected ? ctx.palette.accent : ctx.palette.border,
      );
    },
    onMouseDown(x, y) {
      if (inB(x, y)) armed = true;
    },
    onMouseUp(x, y) {
      if (armed && inB(x, y)) opts.onClick();
      armed = false;
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// BackdropDim — full-canvas darkening quad. Goes first in the screen list.
// ---------------------------------------------------------------------------

export interface BackdropOpts {
  /** Returns the canvas resolution at draw time so resize survives. */
  resolution: () => readonly [number, number];
  alpha?: number;
}

export function makeBackdropDim(opts: BackdropOpts): Widget {
  const dynamicBounds: Bounds = { x: 0, y: 0, w: 0, h: 0 };
  return {
    bounds: dynamicBounds,
    hitTest: () => false,
    draw(ctx) {
      const [w, h] = opts.resolution();
      dynamicBounds.w = w;
      dynamicBounds.h = h;
      ctx.gl.activeTexture(ctx.gl.TEXTURE0);
      ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, ctx.palette.dim);
      ctx.sprites.setAlpha(opts.alpha ?? 0.55);
      ctx.sprites.drawSprite(0, 0, w, h, 0, 0, 1, 1);
      ctx.sprites.setAlpha(1);
    },
    dispose() {},
  };
}
