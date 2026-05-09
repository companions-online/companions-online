export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const MAP_SIZE = 128;
export const CHUNK_SIZE = 16;

export const VIEW_RANGE = 24;
export const INTEREST_RANGE = 32;

/**
 * Chunk-streaming radii. The two are coupled by an invariant: the client's
 * eviction radius must be strictly greater than the server's needed radius,
 * so that any chunk evicted by the client has already been forgotten by the
 * server. Otherwise, when the player walks back into range, the server's
 * `sentChunks` would still claim the client has the chunk and skip the
 * re-stream, leaving a black hole on the client.
 *
 * SERVER_NEEDED_RADIUS_CHUNKS — chunks the server actively streams + retains
 *   in `sentChunks`. Each tick, anything outside this radius is dropped from
 *   `sentChunks` so re-entry triggers a fresh `onChunkNeeded`.
 * CLIENT_EVICT_RADIUS_CHUNKS — chunks the client keeps resident. Anything
 *   outside this radius is dropped from `chunkTerrainData`. The +1 margin
 *   guarantees the client still has the chunk while the server still tracks
 *   it; the client only releases it once the server has too.
 */
export const SERVER_NEEDED_RADIUS_CHUNKS = Math.ceil(INTEREST_RANGE / CHUNK_SIZE);
export const CLIENT_EVICT_RADIUS_CHUNKS = SERVER_NEEDED_RADIUS_CHUNKS + 1;

export const SPAWN_X = Math.floor(MAP_SIZE / 2);
export const SPAWN_Y = Math.floor(MAP_SIZE / 2);

export const AUTOSAVE_WORLD_TICKS = 6000; // 5 minutes at 20Hz

/** Max yields per single harvest invocation (server rule; applies to all
 *  clients). Matches the tree resource pool so one invocation still fully
 *  depletes a tree while rocks/fishing cap at this many. */
export const MAX_HARVEST_YIELDS = 5;

/** Multiplier applied to every harvest/attack tick cost at resolution.
 *  1 = base timings; 2 = doubled. */
export const ACTION_BASE_TICKS = 2;

/** Time scale: 6 real seconds = 10 in-game minutes = 100× speedup. At 20 Hz that's
 *  12 ticks per in-game minute, 720 ticks per in-game hour, 17280 per day (14.4 min real). */
export const TICKS_PER_GAME_MINUTE = 12;
export const TICKS_PER_GAME_HOUR = 720;
export const GAME_MINUTES_PER_DAY = 1440;
export const TICKS_PER_GAME_DAY = 17280;
