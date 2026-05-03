/**
 * Trailing-window token rate tracker. Pushed once per turn from the runner,
 * read on demand by the multi-character dashboard. Pure — no I/O, no timers.
 *
 * Internal representation is the simplest thing that works: a list of
 * `(tMs, completion)` entries, trimmed lazily on read. Per-character call
 * volume is small (one push per LLM turn), so the linear scan is fine.
 */

interface Entry {
  tMs: number;
  completion: number;
}

export interface RateTracker {
  /** Record `completion` tokens at `tMs` (defaults to `Date.now()`). */
  push(completion: number, tMs?: number): void;
  /**
   * Trailing tokens/sec over the last `windowMs` (default 10_000).
   * Returns 0 when no entries fall inside the window. The denominator is
   * `min(windowMs, elapsedSinceFirstEntry)` so early-run rate isn't
   * artificially deflated by an empty leading window.
   */
  rate(windowMs?: number, nowMs?: number): number;
}

export function createRateTracker(): RateTracker {
  const entries: Entry[] = [];
  return {
    push(completion, tMs) {
      if (!completion) return;
      entries.push({ tMs: tMs ?? Date.now(), completion });
    },
    rate(windowMs = 10_000, nowMs) {
      const now = nowMs ?? Date.now();
      const cutoff = now - windowMs;
      while (entries.length > 0 && entries[0].tMs < cutoff) entries.shift();
      if (entries.length === 0) return 0;
      let sum = 0;
      for (const e of entries) sum += e.completion;
      const earliest = entries[0].tMs;
      const elapsedMs = Math.min(windowMs, Math.max(1, now - earliest));
      return (sum * 1000) / elapsedMs;
    },
  };
}
