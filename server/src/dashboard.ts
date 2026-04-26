import { TICK_RATE } from '@shared/constants.js';
import type { TelemetrySnapshot } from './telemetry.js';

const TICK_BUDGET_MS = 1000 / TICK_RATE;
const PHASE_ORDER = ['actions', 'critterAI', 'respawns', 'movement', 'pickups', 'harvest', 'combat', 'broadcast', 'cleanup'];
const LINE = '\u2500'.repeat(53);

let lastRenderTime = performance.now();

export interface DashboardState {
  worldId: string;
  paused: boolean;
  /** Status flash shown on the hint line. Known tags 'saving'/'saved' are
   *  colorized; any other non-empty value renders as a dim tail (e.g.
   *  `dumped 2026-...-dump.json`). */
  saveStatus: string;
  /** Pre-formatted in-game time of day (HH:MM) — main.ts refreshes this
   *  each render from gameMinuteFromTick(world.effectiveTick). */
  currentTimeOfDay: string;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
  return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
}

function formatBytes(bytes: number, elapsed: number): string {
  if (elapsed <= 0) return '  \u2014';
  const perSec = bytes / elapsed;
  if (perSec >= 1024 * 1024) return `${(perSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (perSec >= 1024) return `${(perSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(perSec)} B/s`;
}

export function renderDashboard(snap: TelemetrySnapshot, state: DashboardState): void {
  const now = performance.now();
  const elapsedSec = (now - lastRenderTime) / 1000;

  const tickMs = snap.tickAvgUs / 1000;
  const budgetPct = TICK_BUDGET_MS > 0 ? (tickMs / TICK_BUDGET_MS) * 100 : 0;

  const pauseTag = state.paused ? '  \x1b[33m[PAUSED]\x1b[0m' : '';
  const lines: string[] = [];
  lines.push('');
  lines.push(` Companions Online \u2014 tick ${snap.tick} (${TICK_RATE}Hz)   time ${state.currentTimeOfDay}   uptime ${formatUptime(snap.uptimeMs)}${pauseTag}`);
  lines.push(LINE);
  lines.push(` TICK BUDGET   ${tickMs.toFixed(1)}ms / ${TICK_BUDGET_MS}ms  (${budgetPct.toFixed(0)}%)`);
  lines.push(LINE);
  lines.push(` Phase            avg \u00b5s      %`);

  const phaseMap = new Map(snap.phases.map(p => [p.name, p]));
  for (const name of PHASE_ORDER) {
    const p = phaseMap.get(name);
    const us = p ? p.avgUs : 0;
    const pct = p ? p.pct : 0;
    lines.push(` ${name.padEnd(16)} ${us.toFixed(0).padStart(8)}   ${pct.toFixed(1).padStart(5)}%`);
  }

  lines.push(LINE);
  lines.push(` NETWORK          \u25bc recv        \u25b2 sent       conns`);

  const netMap = new Map(snap.network.map(n => [n.type, n]));
  for (const type of ['ws', 'mcp']) {
    const n = netMap.get(type);
    if (n) {
      const recv = formatBytes(n.recvBytes, elapsedSec);
      const sent = formatBytes(n.sentBytes, elapsedSec);
      lines.push(` ${type.padEnd(12)} ${recv.padStart(10)}    ${sent.padStart(10)}       ${String(n.conns).padStart(3)}`);
    } else {
      lines.push(` ${type.padEnd(12)}       \u2014           \u2014         0`);
    }
  }

  lines.push(LINE);
  lines.push(` WORLD   entities: ${snap.entityCount}   players: ${snap.playerCount}   critters: ${snap.entityCount - snap.playerCount}`);
  lines.push('');

  // Status line
  const saveTag = state.saveStatus === 'saving' ? ' \x1b[33msaving...\x1b[0m' :
                  state.saveStatus === 'saved'  ? ' \x1b[32msaved\x1b[0m' :
                  state.saveStatus             ? ` \x1b[36m${state.saveStatus}\x1b[0m` : '';
  lines.push(` \x1b[2m[q]\x1b[0m quit  \x1b[2m[s]\x1b[0m save  \x1b[2m[p]\x1b[0m pause  \x1b[2m[d]\x1b[0m dump${saveTag}   world: \x1b[36m${state.worldId}\x1b[0m`);

  const cols = process.stdout.columns || 80;
  const out = '\x1b[H' + lines.map(l => l.padEnd(cols)).join('\n');
  process.stdout.write(out);

  lastRenderTime = now;
}
