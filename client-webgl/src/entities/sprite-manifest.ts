// Static list of sprite assets to load at boot. Each entry maps a shared
// BlueprintType to the render-time metadata needed to slice its sprite sheet
// (frame dimensions + foot anchor). Variant count is not duplicated here — it
// lives on the shared Blueprint (`variantCount`) and drives how many PNG
// variants the registry tries to load at boot.
//
// `filename` is the sprite's path relative to client-webgl/assets/, without
// extension. Sub-folders mirror Blueprint.category (creatures/, items/tools/,
// resources/, placeables/, …). Resolved by sprite-registry.ts:
//   variantCount === 1  →  client-webgl/assets/<filename>.png
//   variantCount  >  1  →  client-webgl/assets/<filename>-<variantId>.png   (variantId 0..N-1)
//
// To add a new sprite: set the blueprint's `variantCount` in
// shared/src/blueprints.ts, drop the PNG(s) into the right asset sub-folder,
// and append a SpriteManifestEntry below. Any blueprint without an entry
// falls back to the unknown-entity sprite at runtime.

import { BlueprintType } from '@shared/blueprints.js';

/** Where the sprite's foot anchors relative to the tile diamond.
 *  - `'center'` — foot at diamond center (TILE_H/2). Right for vertically-
 *    extended objects whose base sits at the tile's 3D midpoint: trees,
 *    characters, tall structures.
 *  - `'south'` — foot at diamond south vertex (TILE_H). Right for items
 *    lying on the ground that should visually rest on the tile's nearest
 *    edge: dropped resources, ground loot. */
export type SpriteAlign = 'center' | 'south';

/** Animated sprite-sheet metadata. Frames are laid out left-to-right,
 *  top-to-bottom in a `cols × rows` grid, advancing one frame every
 *  `1000 / fps` ms and looping at `frameCount`. Trailing cells beyond
 *  `frameCount` are ignored. */
export interface SpriteAnimation {
  cols: number;
  rows: number;
  frameCount: number;
  fps: number;
}

export interface SpriteManifestEntry {
  blueprintId: number;
  /** Sprite path relative to client-webgl/assets/, without extension.
   *  E.g. 'creatures/deer', 'items/tools/axe', 'placeables/storage-chest'.
   *  Optional when `aliasOf` is set — in that case no PNG is loaded for
   *  this entry; it borrows another blueprint's already-loaded sheet. */
  filename?: string;
  frameW?: number;
  frameH?: number;
  footX?: number;
  footY?: number;
  /** Reuse another blueprint's already-loaded variant sheet instead of
   *  loading a fresh PNG. When set, `filename`/`frameW`/`frameH`/foot
   *  coordinates / `align` / `animation` / `scale` are all ignored — the
   *  resolved SpriteSheetRef is shared with the aliased entry. The
   *  aliased blueprint+variant must be a non-alias entry that appears
   *  earlier in SPRITE_MANIFEST so it's loaded first. */
  aliasOf?: { blueprintId: number; variant: number };
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
  /** Render-pixel multiplier on top of frameW/frameH. Default 1. Use to make
   *  a sprite render larger or smaller without touching the asset (e.g. fox
   *  at 0.6 → renders at 60 % of its sheet frame size). Foot anchor scales
   *  with it so the sprite still lands on its tile. */
  scale?: number;
  /** Present when this sheet is an animation. The renderer ticks a frame
   *  counter and slices the sheet by col/row. */
  animation?: SpriteAnimation;
}

export const SPRITE_MANIFEST: SpriteManifestEntry[] = [
  // Creatures — use drawCreatureSprite (align doesn't apply, kept default).
  { blueprintId: BlueprintType.Deer,       filename: 'creatures/deer',     frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Rabbit,     filename: 'creatures/rabbit',   frameW: 92, frameH: 92,  footX: 46, footY: 70, scale: 0.6 },
  { blueprintId: BlueprintType.Fox,        filename: 'creatures/fox',      frameW: 92, frameH: 92,  footX: 46, footY: 70, scale: 0.8 },
  { blueprintId: BlueprintType.Wolf,       filename: 'creatures/wolf',     frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Skeleton,   filename: 'creatures/skeleton', frameW: 92, frameH: 92,  footX: 46, footY: 82 },
  { blueprintId: BlueprintType.Player,     filename: 'creatures/player',   frameW: 92, frameH: 92,  footX: 46, footY: 82 },
  // NPCs — reuse player variants. Avatar mapping is the source of truth in
  // shared/src/avatars.ts: catgirl=0, nomad=1, merchant=2, tinkerer=3, beastkin=4, herbalist=5.
  { blueprintId: BlueprintType.Hermit,     aliasOf: { blueprintId: BlueprintType.Player, variant: 4 } }, // beastkin
  { blueprintId: BlueprintType.Trader,     aliasOf: { blueprintId: BlueprintType.Player, variant: 3 } }, // tinkerer
  { blueprintId: BlueprintType.Wanderer,   aliasOf: { blueprintId: BlueprintType.Player, variant: 1 } }, // nomad
  // Tall structures — base at tile center. Single static image.
  { blueprintId: BlueprintType.Tree,       filename: 'resources/tree',     frameW: 64, frameH: 128, footX: 32, footY: 128, detectFoot: true, layout: 'static' },
  // Door — has its own drawDoor path (anchors at south vertex internally).
  { blueprintId: BlueprintType.WoodenDoor, filename: 'placeables/door',    frameW: 64, frameH: 64,  footX: 32, footY: 64 },
  // Campfire — 3×3 grid of 9 frames at 64×64 each. Looping animation; foot
  // sits at the bottom of the logs (south vertex of the tile diamond).
  { blueprintId: BlueprintType.Campfire,   filename: 'placeables/campfire', frameW: 64, frameH: 64, footX: 32, footY: 64, align: 'south', animation: { cols: 3, rows: 3, frameCount: 9, fps: 9 } },
  // Ground items — half-size render (64px PNGs → 32px display), south-vertex anchor.
  { blueprintId: BlueprintType.Wood,       filename: 'resources/wood',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Rock,       filename: 'resources/rock',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Iron,       filename: 'resources/iron',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Hide,       filename: 'resources/hide',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.RawMeat,    filename: 'resources/raw-meat', frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.RawFish,    filename: 'resources/raw-fish', frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  // Tools / weapons / armor / consumables — same ground-item template (64px PNGs → 32px display).
  { blueprintId: BlueprintType.Axe,        filename: 'items/tools/axe',              frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Pickaxe,    filename: 'items/tools/pickaxe',          frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Hammer,     filename: 'items/tools/hammer',           frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.FishingRod, filename: 'items/tools/fishing-rod',      frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.WoodenClub,     filename: 'items/weapons/wooden-club',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.StoneKnife,     filename: 'items/weapons/stone-knife',     frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.IronSword,      filename: 'items/weapons/iron-sword',      frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.IronSpear,      filename: 'items/weapons/iron-spear',      frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.HideVest,       filename: 'items/armor/hide-vest',         frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.HideCap,        filename: 'items/armor/hide-cap',          frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.IronHelm,       filename: 'items/armor/iron-helm',         frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.IronChestplate, filename: 'items/armor/iron-chestplate',   frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.CookedFish, filename: 'items/consumables/cooked-fish', frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.CookedMeat, filename: 'items/consumables/cooked-meat', frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.Bandage,    filename: 'items/consumables/bandage',    frameW: 32, frameH: 32, footX: 16, footY: 32, detectFoot: true, align: 'south', layout: 'static' },
  // Placeables — tile-sized render (64×64 PNGs kept at native size), south-vertex anchor.
  { blueprintId: BlueprintType.StorageChest, filename: 'placeables/storage-chest', frameW: 64, frameH: 64, footX: 32, footY: 64, detectFoot: true, align: 'south', layout: 'static' },
  // WoodenWall is a building tile (wall-sprites.ts draws it in the world). This
  // entry only feeds the inventory icon and placement preview.
  { blueprintId: BlueprintType.WoodenWall,   filename: 'placeables/wooden-wall',   frameW: 64, frameH: 64, footX: 32, footY: 64, detectFoot: true, align: 'south', layout: 'static' },
  // WoodenFloor / StoneFloor are building tiles rendered by the terrain system
  // in-world; these manifest entries feed the inventory icon and placement preview.
  { blueprintId: BlueprintType.WoodenFloor,  filename: 'placeables/wooden-floor',  frameW: 64, frameH: 64, footX: 32, footY: 64, detectFoot: true, align: 'south', layout: 'static' },
  { blueprintId: BlueprintType.StoneFloor,   filename: 'placeables/stone-floor',   frameW: 64, frameH: 64, footX: 32, footY: 64, detectFoot: true, align: 'south', layout: 'static' },
];
