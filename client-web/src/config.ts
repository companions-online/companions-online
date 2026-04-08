/** Isometric tile pixel dimensions (2:1 ratio) */
export const TILE_W = 64;
export const TILE_H = 32;

/** Client view range in tiles from center */
export const CLIENT_VIEW_RANGE = 24;

/** Fixed canvas dimensions */
export const CANVAS_W = 1600;
export const CANVAS_H = 900;

/** HUD region sizes */
export const HUD_RIGHT_W = 300;
export const HUD_TOP_H = 40;
export const HUD_BOTTOM_H = 140;

/** Game viewport within the canvas */
export const GAME_X = 0;
export const GAME_Y = HUD_TOP_H;
export const GAME_W = CANVAS_W - HUD_RIGHT_W;
export const GAME_H = CANVAS_H - HUD_TOP_H - HUD_BOTTOM_H;

/** Number of procedural grass tile variants */
export const GRASS_VARIANTS = 4;
