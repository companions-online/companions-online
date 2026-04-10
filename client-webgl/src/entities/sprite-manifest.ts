// Static list of sprite assets to load at boot. Each entry maps a blueprint id
// (the kind of thing the entity is) to a set of variant PNGs and the per-frame
// metadata needed to slice the sheet.
//
// Filename convention (resolved by sprite-registry.ts):
//   variantCount === 1  →  client-webgl/assets/<name>.png
//   variantCount  >  1  →  client-webgl/assets/<name>-<variantId>.png   (variantId 0..N-1)
//
// To add a new sprite type: drop the .png(s) into client-webgl/assets/, then
// append a SpriteManifestEntry below. Lazy loading is intentionally NOT
// supported — every entry loads at boot.

export interface SpriteManifestEntry {
  blueprintId: number;
  name: string;
  variantCount: number;
  frameW: number;
  frameH: number;
  footX: number;
  footY: number;
}

// Placeholder blueprint id for the local-wander deer until network sync arrives
// and we get real server-issued ids.
export const DEER_BLUEPRINT = 0;

export const SPRITE_MANIFEST: SpriteManifestEntry[] = [
  {
    blueprintId: DEER_BLUEPRINT,
    name: 'deer',
    variantCount: 1,
    frameW: 92,
    frameH: 92,
    footX: 46,
    footY: 70,
  },
];
