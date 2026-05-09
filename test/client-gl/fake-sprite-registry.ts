// Synthetic sprite registry for client-gl tests. Returns a single fake
// SpriteSheetRef for every blueprint — no PNG fetching, no Image decoding,
// no canvas. Tests that care about sprite metadata can pass a custom
// entries map; the default returns an 8-row × 7-col creature-shaped sheet.

import type { SpriteRegistry, SpriteSheetRef } from '@client-webgl/entities/sprite-registry.js';

let handleCounter = 1000;

/** Build a fully-opaque alpha mask for a sheet of the given size — default
 *  for tests that don't care about alpha-aware hit testing. */
function opaqueAlphaMask(sheetW: number, sheetH: number): Uint8Array {
  return new Uint8Array(sheetW * sheetH).fill(255);
}

function defaultSheet(): SpriteSheetRef {
  const sheetW = 92 * 7;   // 7 cols: idle + 6 walk frames
  const sheetH = 92 * 8;   // 8 direction rows
  return {
    // `as unknown` because the real field is WebGLTexture — tests never
    // touch GPU state so a number stands in fine.
    texture: handleCounter++ as unknown as WebGLTexture,
    sheetW,
    sheetH,
    frameW: 92,
    frameH: 92,
    renderW: 92,
    renderH: 92,
    footX: 46,
    footY: 82,
    align: 'center',
    alphaMask: opaqueAlphaMask(sheetW, sheetH),
  };
}

function fallbackSheet(): SpriteSheetRef {
  return {
    texture: handleCounter++ as unknown as WebGLTexture,
    sheetW: 64, sheetH: 64,
    frameW: 64, frameH: 64,
    renderW: 64, renderH: 64,
    footX: 32, footY: 64,
    align: 'center',
    alphaMask: opaqueAlphaMask(64, 64),
    isFallback: true,
  };
}

export interface FakeRegistryOptions {
  /** Blueprints for which resolve() returns a non-fallback sheet. Any id
   *  not in this set resolves to the fallback sheet. Default: Player (0),
   *  Deer (1), Tree (80), WoodenDoor (72). */
  known?: Set<number>;
  /** Override the default sheet per blueprint (e.g. for tree variants). */
  override?: Map<number, SpriteSheetRef>;
}

export function createFakeSpriteRegistry(opts: FakeRegistryOptions = {}): SpriteRegistry {
  const known = opts.known ?? new Set<number>([0, 1, 80, 72]);
  const override = opts.override ?? new Map<number, SpriteSheetRef>();
  const sheets = new Map<number, SpriteSheetRef>();
  const fallback = fallbackSheet();

  return {
    resolve(blueprintId: number): SpriteSheetRef {
      if (override.has(blueprintId)) return override.get(blueprintId)!;
      if (!known.has(blueprintId)) return fallback;
      let s = sheets.get(blueprintId);
      if (!s) {
        s = defaultSheet();
        sheets.set(blueprintId, s);
      }
      return s;
    },
  };
}
