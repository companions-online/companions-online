import { describe, it, expect } from 'vitest';
import {
  makeButton, makeTextInput, makeLabel, makeDivider, makeImage, makeBackdropDim,
  type DrawCtx, type Widget, type KeyEvent,
} from '@client-webgl/ui/widgets.js';
import type { WidgetPalette } from '@client-webgl/ui/widget-palette.js';
import type { TextSurface, TextSurfaceFactory } from '@client-webgl/effects/text-surface.js';
import type { SpriteRenderer } from '@client-webgl/entities/sprite-renderer.js';
import { createMockGL } from './mock-gl.js';

// ---------------------------------------------------------------------------
// Test rig — counting factory + stub sprite renderer + fake palette.
// ---------------------------------------------------------------------------

interface Counts { creates: number; releases: number }

function makeCountingFactory(): { factory: TextSurfaceFactory; counts: Counts } {
  const counts: Counts = { creates: 0, releases: 0 };
  const factory: TextSurfaceFactory = {
    create(opts) {
      counts.creates++;
      const surface: TextSurface = {
        texture: 0 as unknown as WebGLTexture,
        width: opts.text.length * 6,
        height: opts.fontPx,
      };
      return surface;
    },
    release() {
      counts.releases++;
    },
  };
  return { factory, counts };
}

function fakeSprites(): SpriteRenderer {
  return {
    drawSprite() {},
    setAlpha() {},
    setTint() {},
    setLit() {},
    setSpriteTile() {},
    begin() {},
    end() {},
  } as unknown as SpriteRenderer;
}

function fakePalette(): WidgetPalette {
  const t = 0 as unknown as WebGLTexture;
  return { bg: t, bgHover: t, bgPressed: t, border: t, inputBg: t, dim: t, accent: t, textSecondary: t };
}

interface RigOptions { mouseX?: number; mouseY?: number; mouseDown?: boolean; now?: number }

function makeCtx(opts: RigOptions = {}): { ctx: DrawCtx; counts: Counts } {
  const { factory, counts } = makeCountingFactory();
  const ctx: DrawCtx = {
    gl: createMockGL(),
    sprites: fakeSprites(),
    factory,
    palette: fakePalette(),
    mouseX: opts.mouseX ?? 0,
    mouseY: opts.mouseY ?? 0,
    mouseDown: opts.mouseDown ?? false,
    now: opts.now ?? 0,
  };
  return { ctx, counts };
}

function key(k: string): KeyEvent {
  return { key: k };
}

// Fire a click sequence and return whether onClick fired.
function clickSequence(w: Widget, downX: number, downY: number, upX: number, upY: number): void {
  w.onMouseDown?.(downX, downY);
  w.onMouseUp?.(upX, upY);
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

describe('makeButton', () => {
  const bounds = { x: 100, y: 100, w: 80, h: 30 };

  it('hit-tests bounds inclusively at top-left, exclusively at bottom-right', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++ });
    expect(w.hitTest(100, 100)).toBe(true);
    expect(w.hitTest(179, 129)).toBe(true);
    expect(w.hitTest(180, 130)).toBe(false);
    expect(w.hitTest(99, 100)).toBe(false);
    expect(w.hitTest(100, 99)).toBe(false);
    expect(clicks).toBe(0);
  });

  it('fires onClick on mousedown-on-self + mouseup-on-self', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++ });
    clickSequence(w, 110, 110, 120, 115);
    expect(clicks).toBe(1);
  });

  it('does not fire when mouseup leaves bounds', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++ });
    clickSequence(w, 110, 110, 200, 200);
    expect(clicks).toBe(0);
  });

  it('does not fire when mousedown started outside bounds', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++ });
    clickSequence(w, 50, 50, 110, 110);
    expect(clicks).toBe(0);
  });

  it('does not fire when disabled', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++, disabled: true });
    clickSequence(w, 110, 110, 110, 110);
    expect(clicks).toBe(0);
  });

  it('disarms after a missed mouseup so a later in-bounds mouseup alone does nothing', () => {
    let clicks = 0;
    const w = makeButton({ bounds, label: 'Go', onClick: () => clicks++ });
    w.onMouseDown?.(110, 110);
    w.onMouseUp?.(200, 200);     // misses — disarms
    w.onMouseUp?.(110, 110);     // mouseup without a fresh mousedown
    expect(clicks).toBe(0);
  });

  it('caches the label surface across redraws and releases it on dispose', () => {
    const { ctx, counts } = makeCtx();
    const w = makeButton({ bounds, label: 'Go', onClick: () => {} });
    w.draw(ctx);
    w.draw(ctx);
    w.draw(ctx);
    expect(counts.creates).toBe(1);
    w.dispose(ctx.factory);
    expect(counts.releases).toBe(1);
  });

  it('rebuilds the label surface when the label content changes', () => {
    // Style changes on the same widget aren't expressible (label is in opts);
    // but disabled toggling produces a different cached key via labelColor.
    const { ctx, counts } = makeCtx();
    const w1 = makeButton({ bounds, label: 'Go', onClick: () => {} });
    w1.draw(ctx);
    const w2 = makeButton({ bounds, label: 'Stop', onClick: () => {} });
    w2.draw(ctx);
    expect(counts.creates).toBe(2);
  });

  it('dispose before first draw does not release any surface', () => {
    const { ctx, counts } = makeCtx();
    const w = makeButton({ bounds, label: 'Go', onClick: () => {} });
    w.dispose(ctx.factory);
    expect(counts.releases).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

describe('makeTextInput', () => {
  const bounds = { x: 0, y: 0, w: 200, h: 24 };

  it('is focusable', () => {
    const w = makeTextInput({ bounds, initialValue: '' });
    expect(w.isFocusable?.()).toBe(true);
  });

  it('does not consume keys when not focused', () => {
    let value = '';
    const w = makeTextInput({ bounds, initialValue: '', onChange: v => value = v });
    expect(w.onKey?.(key('a'))).toBe(false);
    expect(value).toBe('');
  });

  it('appends printable characters when focused', () => {
    let value = '';
    const w = makeTextInput({ bounds, initialValue: '', onChange: v => value = v });
    w.setFocus?.(true);
    w.onKey?.(key('h'));
    w.onKey?.(key('i'));
    expect(value).toBe('hi');
  });

  it('Backspace pops the last character; backspace on empty is a no-op', () => {
    let value = 'ab';
    const w = makeTextInput({ bounds, initialValue: 'ab', onChange: v => value = v });
    w.setFocus?.(true);
    w.onKey?.(key('Backspace'));
    expect(value).toBe('a');
    w.onKey?.(key('Backspace'));
    expect(value).toBe('');
    expect(w.onKey?.(key('Backspace'))).toBe(true);
    expect(value).toBe('');
  });

  it('Enter calls onSubmit and consumes the key', () => {
    let submitted = 0;
    const w = makeTextInput({ bounds, initialValue: 'x', onSubmit: () => submitted++ });
    w.setFocus?.(true);
    expect(w.onKey?.(key('Enter'))).toBe(true);
    expect(submitted).toBe(1);
  });

  it('Enter without onSubmit bubbles (returns false) so screen-level default fires', () => {
    const w = makeTextInput({ bounds, initialValue: 'x' });
    w.setFocus?.(true);
    expect(w.onKey?.(key('Enter'))).toBe(false);
  });

  it('Escape bubbles so screen-level back fires', () => {
    const w = makeTextInput({ bounds, initialValue: 'x' });
    w.setFocus?.(true);
    expect(w.onKey?.(key('Escape'))).toBe(false);
  });

  it('numericOnly rejects non-digits but consumes the keystroke', () => {
    let value = '';
    const w = makeTextInput({ bounds, initialValue: '', numericOnly: true, onChange: v => value = v });
    w.setFocus?.(true);
    expect(w.onKey?.(key('a'))).toBe(true);
    expect(value).toBe('');
    w.onKey?.(key('4'));
    w.onKey?.(key('2'));
    expect(value).toBe('42');
  });

  it('maxLength caps appends', () => {
    let value = '';
    const w = makeTextInput({ bounds, initialValue: '', maxLength: 3, onChange: v => value = v });
    w.setFocus?.(true);
    for (const ch of 'abcdef') w.onKey?.(key(ch));
    expect(value).toBe('abc');
  });

  it('Tab is not consumed (orchestrator handles focus cycling)', () => {
    const w = makeTextInput({ bounds, initialValue: '' });
    w.setFocus?.(true);
    expect(w.onKey?.(key('Tab'))).toBe(false);
  });

  it('redraws cache the value surface across frames; release on dispose', () => {
    const { ctx, counts } = makeCtx();
    const w = makeTextInput({ bounds, initialValue: 'hello', placeholder: 'name' });
    w.draw(ctx);
    w.draw(ctx);
    expect(counts.creates).toBe(1);
    w.dispose(ctx.factory);
    expect(counts.releases).toBe(1);
  });

  it('placeholder renders when value is empty; releases both surfaces on dispose', () => {
    const { ctx, counts } = makeCtx();
    const w = makeTextInput({ bounds, initialValue: '', placeholder: 'name' });
    w.draw(ctx);
    w.setFocus?.(true);
    w.onKey?.(key('a'));
    w.draw(ctx);
    // Placeholder created on first draw; value surface created on second.
    expect(counts.creates).toBe(2);
    w.dispose(ctx.factory);
    expect(counts.releases).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

describe('makeLabel', () => {
  it('does not hit-test before first draw', () => {
    const w = makeLabel({ x: 0, y: 0, text: 'hi', onClick: () => {} });
    expect(w.hitTest(5, 5)).toBe(false);
  });

  it('non-clickable labels never hit-test', () => {
    const { ctx } = makeCtx();
    const w = makeLabel({ x: 0, y: 0, text: 'hi' });
    w.draw(ctx);
    expect(w.hitTest(5, 5)).toBe(false);
  });

  it('clickable label fires onClick on mouseup-in-bounds after first draw', () => {
    let clicks = 0;
    const { ctx } = makeCtx();
    const w = makeLabel({ x: 10, y: 10, text: 'companions', fontPx: 12, onClick: () => clicks++ });
    w.draw(ctx);
    // Fake factory width = text.length * 6 → 60px wide, 12px tall
    expect(w.hitTest(15, 15)).toBe(true);
    clickSequence(w, 15, 15, 20, 18);
    expect(clicks).toBe(1);
  });

  it('caches surface across draws; release on dispose', () => {
    const { ctx, counts } = makeCtx();
    const w = makeLabel({ x: 0, y: 0, text: 'hi' });
    w.draw(ctx);
    w.draw(ctx);
    w.draw(ctx);
    expect(counts.creates).toBe(1);
    w.dispose(ctx.factory);
    expect(counts.releases).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Divider, Image, BackdropDim — non-interactive; just smoke-test draw + hit-test
// ---------------------------------------------------------------------------

describe('non-interactive widgets', () => {
  it('Divider hit-tests false and draws without throwing', () => {
    const { ctx } = makeCtx();
    const w = makeDivider({ x: 0, y: 0, w: 100, thickness: 2 });
    expect(w.hitTest(50, 1)).toBe(false);
    expect(() => w.draw(ctx)).not.toThrow();
    w.dispose(ctx.factory);
  });

  it('Image hit-tests false and draws without throwing', () => {
    const { ctx } = makeCtx();
    const tex = 0 as unknown as WebGLTexture;
    const w = makeImage({ bounds: { x: 0, y: 0, w: 64, h: 64 }, texture: tex });
    expect(w.hitTest(32, 32)).toBe(false);
    expect(() => w.draw(ctx)).not.toThrow();
    w.dispose(ctx.factory);
  });

  it('BackdropDim hit-tests false and draws full-canvas via the resolution thunk', () => {
    let calls = 0;
    const { ctx } = makeCtx();
    const w = makeBackdropDim({
      resolution: () => { calls++; return [800, 600] as const; },
      alpha: 0.3,
    });
    expect(w.hitTest(400, 300)).toBe(false);
    w.draw(ctx);
    expect(calls).toBe(1);
    expect(w.bounds.w).toBe(800);
    expect(w.bounds.h).toBe(600);
  });
});
