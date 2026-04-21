/** Isometric tile pixel dimensions (2:1 ratio) */
export const TILE_W = 64;
export const TILE_H = 32;

/** Uniform margin around the game viewport — the only chrome. */
export const MARGIN = 15;

/** Game viewport — the playable area. Canvas is sized to fit this plus margins. */
export const GAME_W = 1300;
export const GAME_H = 720;

/** Fixed canvas dimensions — game viewport + uniform margin on all sides. */
export const CANVAS_W = GAME_W + 2 * MARGIN;
export const CANVAS_H = GAME_H + 2 * MARGIN;

/** Game viewport position within the canvas. */
export const GAME_X = MARGIN;
export const GAME_Y = MARGIN;

/** Number of terrain types (matches shared Terrain enum, including rendering-only floors) */
export const TERRAIN_COUNT = 8;

/** Procedural tile variants per terrain type, indexed by Terrain enum value */
export const TERRAIN_VARIANT_COUNTS: readonly number[] = [
  6, // Grass
  4, // Dirt
  4, // Rock
  4, // Sand
  3, // Water
  3, // River
  4, // WoodenFloor (rendering-only)
  4, // StoneFloor  (rendering-only)
];

/** Water/river animation */
export const WATER_ANIM_FRAMES = 8;
export const WATER_FRAME_MS = 160;

/** Elevation: pixels of vertical offset per unit of elevation */
export const PX_PER_Z = 16;

/** Draw a subtle dark outline around each tile diamond (grid debug). */
export const SHOW_TILE_OUTLINES = false;

/** Game area zoom factor. 1 = native (~20×20 tiles visible),
 *  2 = 2× zoom (~10×10 tiles). Fractional values work but produce
 *  bilinear-filtered (slightly soft) pixel art. */
export const GAME_ZOOM = 2;
