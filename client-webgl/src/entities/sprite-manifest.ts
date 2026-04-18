// Static list of sprite assets to load at boot. Each entry maps a shared
// BlueprintType to the render-time metadata needed to slice its sprite sheet
// (frame dimensions + foot anchor). Variant count is not duplicated here — it
// lives on the shared Blueprint (`variantCount`) and drives how many PNG
// variants the registry tries to load at boot.
//
// Filename convention (resolved by sprite-registry.ts):
//   variantCount === 1  →  client-webgl/assets/<name>.png
//   variantCount  >  1  →  client-webgl/assets/<name>-<variantId>.png   (variantId 0..N-1)
//
// To add a new sprite: set the blueprint's `variantCount` in
// shared/src/blueprints.ts, drop the PNG(s) into client-webgl/assets/, and
// append a SpriteManifestEntry below. Any blueprint without an entry falls
// back to the unknown-entity sprite at runtime.

import { BlueprintType } from '@shared/blueprints.js';

/** Where the sprite's foot anchors relative to the tile diamond.
 *  - `'center'` — foot at diamond center (TILE_H/2). Right for vertically-
 *    extended objects whose base sits at the tile's 3D midpoint: trees,
 *    characters, tall structures.
 *  - `'south'` — foot at diamond south vertex (TILE_H). Right for items
 *    lying on the ground that should visually rest on the tile's nearest
 *    edge: dropped resources, ground loot. */
export type SpriteAlign = 'center' | 'south';

export interface SpriteManifestEntry {
  blueprintId: number;
  name: string;
  frameW: number;
  frameH: number;
  footX: number;
  footY: number;
  /** When true, footX/footY are auto-detected per variant from the loaded
   *  image (horizontal center + bottommost opaque row). The manual footX/footY
   *  above are ignored. Useful for static sprites where the "foot" is simply
   *  the bottom of the visible pixels. */
  detectFoot?: boolean;
  /** Tile-diamond anchor point. Defaults to `'center'`. */
  align?: SpriteAlign;
  /** Whether the PNG is a single static image or a multi-frame animation /
   *  variant sheet. When `'static'`, foot coordinates detected from the image
   *  are scaled by `frameW/imageW` and `frameH/imageH` at load time so they
   *  match the rendered frame size. Defaults to `'sheet'` (no scaling). */
  layout?: 'static' | 'sheet';
}

export const SPRITE_MANIFEST: SpriteManifestEntry[] = [
  // Creatures — use drawCreatureSprite (align doesn't apply, kept default).
  { blueprintId: BlueprintType.Deer,       name: 'deer',   frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Rabbit,     name: 'rabbit', frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Fox,        name: 'fox',    frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Wolf,       name: 'wolf',   frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Player,     name: 'player', frameW: 92, frameH: 92,  footX: 46, footY: 82 },
  // Tall structures — base at tile center. Single static image.
  { blueprintId: BlueprintType.Tree,       name: 'tree',   frameW: 64, frameH: 128, footX: 32, footY: 128, detectFoot: true, layout: 'static' },
  // Door — has its own drawDoor path (anchors at south vertex internally).
  { blueprintId: BlueprintType.WoodenDoor, name: 'door',   frameW: 64, frameH: 64,  footX: 32, footY: 64 },
  // Campfire: sprite asset not yet produced — falls back to unknown-entity
  // at runtime. Light emission is driven by blueprint.lightRadius regardless
  // of sprite, so placing a campfire still casts light. Add the manifest entry
  // once a `fire-*.png` asset exists.
  // Ground items — half-size render (64px PNGs → 32px display), south-vertex anchor.
  { blueprintId: BlueprintType.Wood,       name: 'wood',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Rock,       name: 'rock',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Iron,       name: 'iron',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Hide,       name: 'hide',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.RawMeat,    name: 'rawmeat', frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.RawFish,    name: 'fish',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
];
