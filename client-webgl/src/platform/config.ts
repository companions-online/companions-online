/** Isometric tile pixel dimensions (2:1 ratio) */
export const TILE_W = 64;
export const TILE_H = 32;

/** Fixed canvas dimensions */
export const CANVAS_W = 1600;
export const CANVAS_H = 900;

/** HUD region sizes (reserved canvas chrome around the game area) */
export const HUD_RIGHT_W = 300;
export const HUD_TOP_H = 40;
export const HUD_BOTTOM_H = 140;

/** Game viewport within the canvas */
export const GAME_X = 0;
export const GAME_Y = HUD_TOP_H;
export const GAME_W = CANVAS_W - HUD_RIGHT_W;
export const GAME_H = CANVAS_H - HUD_TOP_H - HUD_BOTTOM_H;

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
