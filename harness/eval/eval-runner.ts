import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'http';
import { serve } from '@hono/node-server';
import { GameWorld, createDefaultWorld } from '../../server/src/game-world.js';
import { GameLoop } from '../../server/src/ecs/game-loop.js';
import { Telemetry } from '../../server/src/telemetry.js';
import { createApp } from '../../server/src/app.js';
import { TICK_RATE } from '../../shared/src/constants.js';
import type { TokenUsage } from '../openrouter.js';
import type { Decider } from '../decider.js';
import type { Logger } from '../logger.js';
import type { MemoryFile } from '../memory-file.js';
import type { RunVariantOpts, VariantResult } from '../compact.js';
import { runCompact } from '../compact.js';
import { runBaseline } from '../baseline.js';
import { runTruncated } from '../truncated.js';
import { Scoreboard } from './scoreboard.js';
import type { Checkpoint } from './match.js';

export type HarnessVariant = 'compact' | 'baseline' | 'truncated';

export interface EvalConfig {
  name: string;
  harness: HarnessVariant;
  worldSeed: number;
  maxTurns: number;
  maxTokens: number;
  port?: number;
  checkpoints: Checkpoint[];
}

export type StopReason =
  | 'all_checkpoints'
  | 'max_turns'
  | 'max_tokens'
  | 'aborted'
  | 'error';

export interface EvalResult {
  runId: string;
  llmConfigName: string;
  evalConfig: EvalConfig;
  score: number;
  total: number;
  checkpointsHit: string[];
  turnCount: number;
  totalTokens: number;
  stopReason: StopReason;
  error?: string;
  aiEid: number | null;
}

export interface RunEvalOpts {
  llmConfigName: string;
  llmConfigDir?: string;
  evalConfig: EvalConfig;
  abortSignal?: AbortSignal;
  /** Test injection — defaults to `createDefaultWorld(seed)`. */
  worldFactory?: (seed: number) => GameWorld;
  /** Test injection — bypasses OpenRouter when provided. */
  decider?: Decider;
  /** Test injection — silent logger to skip disk writes. */
  logger?: Logger;
  /** Test injection — inject a temp-dir memory file. */
  memory?: MemoryFile;
  /** Where per-run JSON results land. Defaults to `harness/eval/runs`. */
  resultsDir?: string;
}

const RUN_FNS: Record<HarnessVariant, (opts: RunVariantOpts) => Promise<VariantResult>> = {
  compact: runCompact,
  baseline: runBaseline,
  truncated: runTruncated,
};

export async function runEval(opts: RunEvalOpts): Promise<EvalResult> {
  const { llmConfigName, evalConfig } = opts;
  const runId = randomUUID();

  const world = (opts.worldFactory ?? createDefaultWorld)(evalConfig.worldSeed);
  const playersBefore = new Set(world.players.keys());

  const telemetry = new Telemetry();
  // GameWorld constructs its own Telemetry; createApp expects one passed in.
  const { app } = createApp(world, telemetry);

  const port = evalConfig.port ?? 0;
  const { server, actualPort } = await listen(app.fetch, port);

  const loop = new GameLoop(TICK_RATE);
  loop.start(() => world.runTick());

  const scoreboard = new Scoreboard(world, evalConfig.checkpoints, playersBefore);
  scoreboard.attach();

  const prevMcpUrl = process.env.MCP_URL;
  process.env.MCP_URL = `http://127.0.0.1:${actualPort}/mcp`;

  let totalTokens = 0;
  let turnCount = 0;
  let stopReason: StopReason | null = null;
  let errorMessage: string | undefined;

  const onTurnComplete = (step: number, usage?: TokenUsage): void | 'stop' => {
    turnCount = step;
    if (usage?.total_tokens) totalTokens += usage.total_tokens;
    if (scoreboard.isComplete()) { stopReason = 'all_checkpoints'; return 'stop'; }
    if (totalTokens >= evalConfig.maxTokens) { stopReason = 'max_tokens'; return 'stop'; }
  };

  const runFn = RUN_FNS[evalConfig.harness];
  try {
    const variantResult = await runFn({
      configName: llmConfigName,
      configDir: opts.llmConfigDir,
      maxSteps: evalConfig.maxTurns,
      abortSignal: opts.abortSignal,
      decider: opts.decider,
      logger: opts.logger,
      memory: opts.memory,
      onTurnComplete,
    });
    if (stopReason == null) {
      if (variantResult.stopReason === 'aborted') stopReason = 'aborted';
      else if (variantResult.stopReason === 'max_steps') stopReason = 'max_turns';
      else stopReason = 'max_turns'; // 'completed' shouldn't occur with maxSteps set
    }
    turnCount = variantResult.stepCount;
  } catch (e) {
    stopReason = 'error';
    errorMessage = String((e as Error).message ?? e);
  } finally {
    loop.stop();
    await new Promise<void>(r => server.close(() => r()));
    if (prevMcpUrl !== undefined) process.env.MCP_URL = prevMcpUrl;
    else delete process.env.MCP_URL;
  }

  const result: EvalResult = {
    runId,
    llmConfigName,
    evalConfig,
    score: scoreboard.score,
    total: scoreboard.total,
    checkpointsHit: scoreboard.getHits(),
    turnCount,
    totalTokens,
    stopReason: stopReason ?? 'error',
    error: errorMessage,
    aiEid: scoreboard.getAiEid(),
  };

  const dir = opts.resultsDir ?? 'harness/eval/runs';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.json`), JSON.stringify(result, null, 2), 'utf8');

  return result;
}

async function listen(fetch: (req: Request) => Response | Promise<Response>, port: number): Promise<{ server: Server; actualPort: number }> {
  return new Promise((resolve) => {
    const server = serve({ fetch, port }, (info) => {
      resolve({ server: server as Server, actualPort: info.port });
    }) as Server;
  });
}

export function formatResultLine(result: EvalResult): string {
  const hits = result.checkpointsHit.length === 0 ? 'none' : result.checkpointsHit.join(', ');
  const err = result.error ? ` — error: ${result.error}` : '';
  return `score ${result.score}/${result.total} — hit: ${hits} — turns: ${result.turnCount} — tokens: ${result.totalTokens} — stop: ${result.stopReason}${err}`;
}
