export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const MAP_SIZE = 128;
export const CHUNK_SIZE = 16;

export const VIEW_RANGE = 24;
export const INTEREST_RANGE = 32;

export const SPAWN_X = Math.floor(MAP_SIZE / 2);
export const SPAWN_Y = Math.floor(MAP_SIZE / 2);

export const AUTOSAVE_WORLD_TICKS = 6000; // 5 minutes at 20Hz

/** Max yields per single harvest invocation (server rule; applies to all
 *  clients). Matches the tree resource pool so one invocation still fully
 *  depletes a tree while rocks/fishing cap at this many. */
export const MAX_HARVEST_YIELDS = 5;

/** Time scale: 6 real seconds = 10 in-game minutes = 100× speedup. At 20 Hz that's
 *  12 ticks per in-game minute, 720 ticks per in-game hour, 17280 per day (14.4 min real). */
export const TICKS_PER_GAME_MINUTE = 12;
export const TICKS_PER_GAME_HOUR = 720;
export const GAME_MINUTES_PER_DAY = 1440;
export const TICKS_PER_GAME_DAY = 17280;
