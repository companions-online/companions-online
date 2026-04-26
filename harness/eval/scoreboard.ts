import type { GameWorld } from '../../server/src/game-world.js';
import type { GameEvent } from '../../server/src/events.js';
import { matches, type Checkpoint } from './match.js';

/**
 * Tracks behavioral checkpoints hit by the AI player during an eval run.
 *
 * `playersBefore` is a snapshot of `world.players.keys()` taken before the
 * harness connects. The first event emitted on the `'emit'` channel for an
 * eid that wasn't in that snapshot identifies the AI player. Broadcasts
 * (third-person spectator events) are ignored.
 */
export class Scoreboard {
  private aiEid: number | null = null;
  private readonly hits = new Set<string>();

  constructor(
    private readonly world: GameWorld,
    private readonly checkpoints: Checkpoint[],
    private readonly playersBefore: Set<number>,
  ) {}

  attach(): void {
    this.world.setEventObserver((eid, ev, channel) => this.onEvent(eid, ev, channel));
  }

  onEvent(eid: number, ev: GameEvent, channel: 'emit' | 'broadcast'): void {
    if (channel !== 'emit') return;
    if (this.aiEid == null) {
      for (const k of this.world.players.keys()) {
        if (!this.playersBefore.has(k)) { this.aiEid = k; break; }
      }
    }
    if (this.aiEid == null || eid !== this.aiEid) return;
    for (const cp of this.checkpoints) {
      if (matches(cp, ev)) this.hits.add(cp.id);
    }
  }

  getAiEid(): number | null { return this.aiEid; }
  getHits(): string[] { return [...this.hits]; }
  isComplete(): boolean { return this.checkpoints.length > 0 && this.hits.size === this.checkpoints.length; }
  get score(): number { return this.hits.size; }
  get total(): number { return this.checkpoints.length; }
}
