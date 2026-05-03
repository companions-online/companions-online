// Avatar tile row for the create-join screen. One tile per known player
// variant — currently just catgirl (variant 0). New variants drop in by
// adding entries to KNOWN_VARIANTS and shipping a `player-<n>.png` next
// to the existing `player.png`; the sprite-registry's per-variant load
// path (sprite-registry.ts::pathFor) handles the file resolution.
//
// Each tile shows the south-facing idle frame of the player walk-cycle
// sheet (col 0 of the dir=S row), cropped to the tile inset. The
// selected tile gets the palette.accent border via makeSelectableTile.

import { BlueprintType } from '@shared/blueprints.js';
import { Direction } from '@shared/direction.js';
import type { SpriteRegistry } from '../entities/sprite-registry.js';
import { makeSelectableTile, type Widget } from './widgets.js';

const TILE_SIZE = 72;
const TILE_GAP = 8;

interface AvatarVariant {
  id: number;
  label: string;
}

/** Variants the avatar selector can offer. Add new entries as new
 *  player-<n>.png sheets land. The id matches the BlueprintVariant
 *  carried over the wire by the /avatar server command (Phase 4). */
const KNOWN_VARIANTS: AvatarVariant[] = [
  { id: 0, label: 'catgirl' },
];

/** Number of frames in the player walk cycle, used to figure out where
 *  the south-facing idle frame sits in the sheet. The drawCreatureSprite
 *  layout reserves col 0 of each direction row for idle. */
function southIdleUv(sheet: { sheetW: number; sheetH: number; frameW: number; frameH: number }) {
  // Direction.S = 4; row = (dir + 1) % 8 = 5 (matches creature-entity.ts).
  const row = (Direction.S + 1) % 8;
  const col = 0;
  return {
    srcU: (col * sheet.frameW) / sheet.sheetW,
    srcV: (row * sheet.frameH) / sheet.sheetH,
    srcDU: sheet.frameW / sheet.sheetW,
    srcDV: sheet.frameH / sheet.sheetH,
  };
}

export interface AvatarTilesOpts {
  /** Top-left of the row in canvas pixels. */
  x: number;
  y: number;
  selected: number;
  onSelect: (variant: number) => void;
  spriteRegistry: SpriteRegistry;
}

export function buildAvatarTiles(opts: AvatarTilesOpts): Widget[] {
  const widgets: Widget[] = [];
  for (let i = 0; i < KNOWN_VARIANTS.length; i++) {
    const variant = KNOWN_VARIANTS[i];
    const sheet = opts.spriteRegistry.resolve(BlueprintType.Player, variant.id);
    const uv = southIdleUv(sheet);
    widgets.push(makeSelectableTile({
      bounds: {
        x: opts.x + i * (TILE_SIZE + TILE_GAP),
        y: opts.y,
        w: TILE_SIZE, h: TILE_SIZE,
      },
      texture: sheet.texture,
      srcU: uv.srcU, srcV: uv.srcV, srcDU: uv.srcDU, srcDV: uv.srcDV,
      selected: opts.selected === variant.id,
      onClick: () => opts.onSelect(variant.id),
    }));
  }
  return widgets;
}

/** Total width occupied by all variant tiles, used by the create-join
 *  screen to position adjacent labels. */
export function avatarRowWidth(): number {
  const n = KNOWN_VARIANTS.length;
  return n * TILE_SIZE + (n - 1) * TILE_GAP;
}
