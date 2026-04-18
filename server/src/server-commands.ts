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

// --- Built-in commands ---

const NICK_PATTERN = /^[A-Za-z0-9_\-]+$/;
const NICK_MIN = 1;
const NICK_MAX = 16;

const handleNick: ServerCommandHandler = (world, eid, _slot, parameter) => {
  const nick = parameter.trim();
  if (nick.length < NICK_MIN || nick.length > NICK_MAX) {
    return { ok: false, error: `name must be ${NICK_MIN}-${NICK_MAX} characters` };
  }
  if (!NICK_PATTERN.test(nick)) {
    return { ok: false, error: 'name must be letters, digits, underscore, or hyphen' };
  }
  world.setEntityMeta(eid, MetaKey.Name, nick);
  return { ok: true };
};

registerServerCommand(['nick', 'name'], handleNick);
