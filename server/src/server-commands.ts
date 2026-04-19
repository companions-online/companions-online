import { MetaKey } from '@shared/entity-meta.js';
import type { GameWorld, PlayerSlot } from './game-world.js';

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
