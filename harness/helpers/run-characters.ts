import { runBaseline } from '../variants/baseline.js';
import { runCompact } from '../variants/compact.js';
import { runShortened } from '../variants/shortened.js';
import { runIncrementalCompaction } from '../variants/incremental-compaction.js';
import { createRateTracker } from './rate-tracker.js';
import type { Character, HarnessVariant } from './characters-config.js';
import type { Decider } from './decider.js';
import type { Logger } from './logger.js';
import type { CharacterRow } from './characters-dashboard.js';
import type { RunVariantOpts, VariantResult, UsageAccumulator } from './runner.js';

const RUN_FNS: Record<HarnessVariant, (opts: RunVariantOpts) => Promise<VariantResult>> = {
  baseline: runBaseline,
  compact: runCompact,
  shortened: runShortened,
  'incremental-compaction': runIncrementalCompaction,
};

export interface RunCharactersOpts {
  abortSignal?: AbortSignal;
  /** Test injection: same array length as `characters`, one decider per character. */
  deciders?: Decider[];
  /** Test injection: shared logger (test usually passes a noop). Defaults to per-character quiet logger. */
  logger?: Logger;
  /** Test-only step cap forwarded to each variant. */
  maxSteps?: number;
}

export interface RunCharactersResult {
  failures: { name: string; error: Error }[];
}

/**
 * Build the per-character row state up-front (synchronously) so callers can
 * mount a live dashboard against the same row references before the runner
 * starts mutating them.
 */
export function createCharacterRows(characters: Character[]): CharacterRow[] {
  return characters.map((c) => ({
    name: c.prompt,
    modelLabel: c.model.model,
    usage: { prompt: 0, completion: 0, total: 0, costUsd: 0, mcpCalls: 0, startedAtMs: Date.now() } as UsageAccumulator,
    rate: createRateTracker(),
    status: { step: 0 },
    done: false,
  }));
}

/**
 * Boot N characters concurrently against the same MCP server. Each character
 * gets its own bootstrap → its own MCP client, sessionId, scratchpad, and
 * UsageAccumulator. Caller owns the row objects (built via
 * `createCharacterRows`) and can read them live during the run.
 */
export async function runCharacters(
  characters: Character[],
  rows: CharacterRow[],
  opts: RunCharactersOpts = {},
): Promise<RunCharactersResult> {
  if (rows.length !== characters.length) {
    throw new Error(`runCharacters: rows length (${rows.length}) != characters length (${characters.length})`);
  }
  const settled = await Promise.allSettled(
    characters.map((c, i) => runOne(c, rows[i], i, opts)),
  );

  const failures: { name: string; error: Error }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const err = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
      failures.push({ name: rows[i].name, error: err });
    }
  });

  return { failures };
}

async function runOne(
  c: Character,
  row: CharacterRow,
  index: number,
  opts: RunCharactersOpts,
): Promise<void> {
  const run = RUN_FNS[c.harness];
  try {
    await run({
      config: c.model,
      promptName: c.prompt,
      quiet: true,
      abortSignal: opts.abortSignal,
      decider: opts.deciders?.[index],
      logger: opts.logger,
      maxSteps: opts.maxSteps,
      usage: row.usage,
      rate: row.rate,
      onTurnComplete: ({ step, lastToolName, lastInlineText }) => {
        row.status = { step, lastToolName, lastInlineText };
      },
    });
  } finally {
    row.done = true;
  }
}
