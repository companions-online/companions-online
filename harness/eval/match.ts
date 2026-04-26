import type { GameEvent } from '../../server/src/events.js';

export interface Checkpoint {
  id: string;
  event: GameEvent['type'];
  /** Shallow equality check against `event.details`. Omitted fields don't matter. */
  match?: Record<string, unknown>;
}

export function matches(cp: Checkpoint, ev: GameEvent): boolean {
  if (ev.type !== cp.event) return false;
  if (!cp.match) return true;
  const details = ((ev as unknown) as { details?: Record<string, unknown> }).details ?? {};
  for (const [k, v] of Object.entries(cp.match)) {
    if (details[k] !== v) return false;
  }
  return true;
}
