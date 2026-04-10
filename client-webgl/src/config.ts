/** Isometric tile pixel dimensions (2:1 ratio) */
export const TILE_W = 64;
export const TILE_H = 32;

/** Fixed canvas dimensions */
export const CANVAS_W = 1600;
export const CANVAS_H = 900;

/** Number of terrain types (matches shared Terrain enum) */
export const TERRAIN_COUNT = 6;

/** Procedural tile variants per terrain type, indexed by Terrain enum value */
export const TERRAIN_VARIANT_COUNTS: readonly number[] = [
  6, // Grass
  4, // Dirt
  4, // Rock
  4, // Sand
  3, // Water
  3, // River
];

/** Water/river animation */
export const WATER_ANIM_FRAMES = 4;
export const WATER_FRAME_MS = 160;

/** Elevation: pixels of vertical offset per unit of elevation */
export const PX_PER_Z = 16;

/** Draw a subtle dark outline around each tile diamond (grid debug). */
export const SHOW_TILE_OUTLINES = false;
