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
}

export const SPRITE_MANIFEST: SpriteManifestEntry[] = [
  { blueprintId: BlueprintType.Deer,       name: 'deer',   frameW: 92, frameH: 92,  footX: 46, footY: 70 },
  { blueprintId: BlueprintType.Player,     name: 'player', frameW: 92, frameH: 92,  footX: 46, footY: 82 },
  { blueprintId: BlueprintType.Tree,       name: 'tree',   frameW: 64, frameH: 128, footX: 32, footY: 128, detectFoot: true },
  { blueprintId: BlueprintType.WoodenDoor, name: 'door',   frameW: 64, frameH: 64,  footX: 32, footY: 64 },
];
