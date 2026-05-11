import { computeAps, type UsageAccumulator } from './runner.js';
import type { RateTracker } from './rate-tracker.js';

export interface CharacterRow {
  name: string;
  modelLabel: string;
  usage: UsageAccumulator;
  rate: RateTracker;
  status: { step: number; lastToolName?: string; lastInlineText?: string };
  done: boolean;
}

export interface Dashboard {
  stop(): void;
}

const LINE = '─'.repeat(90);

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
  return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function renderRow(row: CharacterRow): string {
  const tps = row.rate.rate(10_000);
  const aps = computeAps(row.usage);
  const name = row.name.padEnd(10);
  const model = truncate(row.modelLabel, 32).padEnd(32);
  const step = String(row.status.step).padStart(5);
  const tpsStr = tps.toFixed(1).padStart(8);
  const apsStr = aps.toFixed(1).padStart(8);
  const tok = String(row.usage.completion).padStart(7);
  const cost = `$${row.usage.costUsd.toFixed(4)}`.padStart(9);
  const tag = row.done ? ' done' : '';
  return ` ${name} ${model}  ${step}  ${tpsStr}  ${apsStr}  ${tok}  ${cost}${tag}`;
}

/**
 * Live ANSI dashboard — one row per character, redrawn on a setInterval.
 * Modeled on `server/src/dashboard.ts`: cursor-home + per-line padding so
 * trailing characters from previous frames are blanked.
 *
 * The TUI assumes the runner's logger was created with `quiet: true` so
 * nothing else writes to stdout while it's mounted.
 */
export function startDashboard(rows: CharacterRow[], intervalMs = 250): Dashboard {
  const startedAt = performance.now();
  process.stdout.write('\x1b[2J\x1b[H');

  const draw = (): void => {
    const cols = process.stdout.columns || 80;
    const lines: string[] = [];
    lines.push('');
    lines.push(` Companions Online — characters    uptime ${formatUptime(performance.now() - startedAt)}`);
    lines.push(LINE);
    lines.push(
      ` ${'NAME'.padEnd(10)} ${'MODEL'.padEnd(32)}  ${'STEP'.padStart(5)}  ${'TPS(10s)'.padStart(8)}  ${'APS'.padStart(8)}  ${'TOK'.padStart(7)}  ${'COST'.padStart(9)}`,
    );
    for (const row of rows) lines.push(renderRow(row));
    lines.push(LINE);
    lines.push(' [Ctrl-C] quit');
    process.stdout.write('\x1b[H' + lines.map(l => l.padEnd(cols)).join('\n') + '\n');
  };

  draw();
  const handle = setInterval(draw, intervalMs);

  return {
    stop(): void {
      clearInterval(handle);
      // Leave the final frame on screen but move cursor below it for any
      // post-run summary writes.
      process.stdout.write('\n');
    },
  };
}

export function printFinalSummary(rows: CharacterRow[]): void {
  console.log('');
  for (const row of rows) {
    const cost = row.usage.costUsd > 0 ? ` cost=$${row.usage.costUsd.toFixed(4)}` : '';
    const aps = computeAps(row.usage).toFixed(1);
    console.log(
      `[${row.name}] steps=${row.status.step} actions=${row.usage.mcpCalls} aps=${aps} tokens: in=${row.usage.prompt} out=${row.usage.completion} total=${row.usage.total}${cost}`,
    );
  }
}
