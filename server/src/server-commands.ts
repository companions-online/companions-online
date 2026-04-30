import { MetaKey } from '@shared/entity-meta.js';
import { BlueprintType, getBlueprintByName } from '@shared/blueprints.js';
import { TICKS_PER_GAME_MINUTE, TICKS_PER_GAME_DAY } from '@shared/constants.js';
import type { GameWorld, PlayerSlot } from './game-world.js';
import { initCritterForEntity } from './systems/critter-ai.js';
import { spawnCreatureEntity, spawnGroundItem } from './entity-spawn.js';

export type ServerCommandResult = { ok: true } | { ok: false; error: string };

export type ServerCommandHandler = (
  world: GameWorld,
  eid: number,
  slot: PlayerSlot,
  parameter: string,
) => ServerCommandResult;

const REGISTRY: Map<string, ServerCommandHandler> = new Map();

export function registerServerCommand(aliases: string[], handler: ServerCommandHandler): void {
  for (const alias of aliases) {
    REGISTRY.set(alias.toLowerCase(), handler);
  }
}

export function dispatchServerCommand(
  world: GameWorld,
  eid: number,
  slot: PlayerSlot,
  command: string,
  parameter: string,
): ServerCommandResult {
  const handler = REGISTRY.get(command.toLowerCase());
  if (!handler) return { ok: false, error: `unknown command: ${command}` };
  return handler(world, eid, slot, parameter);
}

// --- Name validation (shared with MCP identify tool) ---

export const NICK_PATTERN = /^[A-Za-z0-9_\-]+$/;
export const NICK_MIN = 1;
export const NICK_MAX = 16;

export type NameValidation = { ok: true; name: string } | { ok: false; error: string };

export function validateName(raw: string): NameValidation {
  const name = raw.trim();
  if (name.length < NICK_MIN || name.length > NICK_MAX) {
    return { ok: false, error: `name must be ${NICK_MIN}-${NICK_MAX} characters` };
  }
  if (!NICK_PATTERN.test(name)) {
    return { ok: false, error: 'name must be letters, digits, underscore, or hyphen' };
  }
  return { ok: true, name };
}

// --- Built-in commands ---

const handleNick: ServerCommandHandler = (world, eid, _slot, parameter) => {
  const check = validateName(parameter);
  if (!check.ok) return { ok: false, error: check.error };
  world.setEntityMeta(eid, MetaKey.Name, check.name);
  return { ok: true };
};

registerServerCommand(['nick', 'name'], handleNick);

// --- /spawn <creature-or-item-name> ---
// Dev/god command. Resolves a blueprint by display name (case-insensitive),
// finds an open tile within 6 tiles of the caller, and spawns the entity.
// Rejects Player/Tree, NPCs, and placeables (placeables need UseItemAt).

const SPAWN_RADIUS = 6;

const handleSpawn: ServerCommandHandler = (world, eid, _slot, parameter) => {
  const name = parameter.trim();
  if (!name) return { ok: false, error: 'usage: /spawn <creature-or-item-name>' };
  const bp = getBlueprintByName(name);
  if (!bp) return { ok: false, error: `unknown blueprint: ${name}` };
  if (bp.id === BlueprintType.Player || bp.id === BlueprintType.Tree) {
    return { ok: false, error: `cannot /spawn ${bp.name}` };
  }
  if (bp.category === 'npc') return { ok: false, error: 'cannot /spawn NPCs' };
  if (bp.category === 'placeable') {
    return { ok: false, error: `${bp.name} is a placeable — equip it and UseItemAt instead` };
  }
  const pos = world.entities.position.get(eid);
  if (!pos) return { ok: false, error: 'caller has no position' };

  const requireUnoccupied = bp.collides === true || bp.category === 'creature';
  const tile = world.findOpenTileNear(pos.tileX, pos.tileY, SPAWN_RADIUS, requireUnoccupied);
  if (!tile) return { ok: false, error: `no open tile within ${SPAWN_RADIUS}` };

  if (bp.category === 'creature') {
    const newEid = spawnCreatureEntity(world, bp.id, tile.x, tile.y);
    initCritterForEntity(newEid, world);
  } else {
    spawnGroundItem(world, bp.id, tile.x, tile.y);
  }
  return { ok: true };
};
registerServerCommand(['spawn'], handleSpawn);

// --- /time <preset|HH|HH:MM> ---
// Shifts world.tickOffset so the current effective in-game time matches the
// request. Presets: day/noon=12, night/midnight=0, dawn/sunrise=5,
// twilight/dusk/sunset=19.

const TIME_PRESETS: Record<string, number> = {
  day: 12 * 60, noon: 12 * 60,
  night: 0, midnight: 0,
  dawn: 5 * 60, sunrise: 5 * 60,
  twilight: 19 * 60, dusk: 19 * 60, sunset: 19 * 60,
};

function parseTimeSpec(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (s in TIME_PRESETS) return TIME_PRESETS[s];
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] !== undefined ? Number(m[2]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

const handleTime: ServerCommandHandler = (world, _eid, _slot, parameter) => {
  const minutes = parseTimeSpec(parameter);
  if (minutes === null) {
    return { ok: false, error: 'usage: /time <day|night|dawn|dusk|HH|HH:MM>' };
  }
  const targetTicks = minutes * TICKS_PER_GAME_MINUTE;
  const currentDayTick = ((world.currentTick % TICKS_PER_GAME_DAY) + TICKS_PER_GAME_DAY) % TICKS_PER_GAME_DAY;
  const offset = ((targetTicks - currentDayTick) % TICKS_PER_GAME_DAY + TICKS_PER_GAME_DAY) % TICKS_PER_GAME_DAY;
  world.setTickOffset(offset);
  return { ok: true };
};
registerServerCommand(['time'], handleTime);
