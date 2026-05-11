import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runPath, LOGS_DIR } from '../helpers/paths.js';
import type { Server } from 'http';
import { serve } from '@hono/node-server';
import { GameWorld, createDefaultWorld } from '../../server/src/game-world.js';
import { GameLoop } from '../../server/src/ecs/game-loop.js';
import { Telemetry } from '../../server/src/telemetry.js';
import { createApp } from '../../server/src/app.js';
import { TICK_RATE } from '../../shared/src/constants.js';
import type { TurnCompleteCtx } from '../helpers/runner.js';
import type { Decider } from '../helpers/decider.js';
import type { Logger } from '../helpers/logger.js';
import type { Scratchpad } from '../helpers/scratchpad.js';
import { computeAps, type RunVariantOpts, type VariantResult, type UsageAccumulator } from '../helpers/runner.js';
import { runCompact } from '../variants/compact.js';
import { runBaseline } from '../variants/baseline.js';
import { runShortened } from '../variants/shortened.js';
import { Scoreboard } from './scoreboard.js';
import type { Checkpoint } from './match.js';

export type HarnessVariant = 'compact' | 'baseline' | 'shortened';

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
  promptTokens: number;
  completionTokens: number;
  /** Number of MCP tool calls dispatched during the run. */
  mcpCallCount: number;
  /** Cumulative MCP calls per second over the run's wall-clock duration. */
  actionsPerSec: number;
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
  memory?: Scratchpad;
  /** Where per-run JSON results land. Defaults to `harness/logs/`. Tests override. */
  resultsDir?: string;
  /** Mutable token accumulator forwarded to the variant runner. */
  usage?: UsageAccumulator;
}

const RUN_FNS: Record<HarnessVariant, (opts: RunVariantOpts) => Promise<VariantResult>> = {
  compact: runCompact,
  baseline: runBaseline,
  shortened: runShortened,
};

export async function runEval(opts: RunEvalOpts): Promise<EvalResult> {
  const { llmConfigName, evalConfig } = opts;
  // Single UUID for the whole run: the eval's runId IS the harness sessionId,
  // so log/scratchpad/run-result artifacts share the same prefix on disk.
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

  const usage: UsageAccumulator = opts.usage ?? {
    prompt: 0, completion: 0, total: 0, costUsd: 0, mcpCalls: 0, startedAtMs: Date.now(),
  };

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let turnCount = 0;
  let stopReason: StopReason | null = null;
  let errorMessage: string | undefined;

  const onTurnComplete = ({ step, usage }: TurnCompleteCtx): void | 'stop' => {
    turnCount = step;
    if (usage?.total_tokens) totalTokens += usage.total_tokens;
    if (usage?.prompt_tokens) promptTokens += usage.prompt_tokens;
    if (usage?.completion_tokens) completionTokens += usage.completion_tokens;
    if (scoreboard.isComplete()) { stopReason = 'all_checkpoints'; return 'stop'; }
    if (totalTokens >= evalConfig.maxTokens) { stopReason = 'max_tokens'; return 'stop'; }
  };

  const runFn = RUN_FNS[evalConfig.harness];
  try {
    const variantResult = await runFn({
      configName: llmConfigName,
      configDir: opts.llmConfigDir,
      sessionId: runId,
      maxSteps: evalConfig.maxTurns,
      abortSignal: opts.abortSignal,
      decider: opts.decider,
      logger: opts.logger,
      memory: opts.memory,
      onTurnComplete,
      usage,
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
    promptTokens,
    completionTokens,
    mcpCallCount: usage.mcpCalls,
    actionsPerSec: computeAps(usage),
    stopReason: stopReason ?? 'error',
    error: errorMessage,
    aiEid: scoreboard.getAiEid(),
  };

  const file = opts.resultsDir
    ? join(opts.resultsDir, `${runId}.json`)
    : runPath(runId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');

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
  const tokens = `in=${result.promptTokens}/out=${result.completionTokens}/total=${result.totalTokens}`;
  const actions = `${result.mcpCallCount} (${result.actionsPerSec.toFixed(1)}/s)`;
  return `score ${result.score}/${result.total} — hit: ${hits} — turns: ${result.turnCount} — tokens: ${tokens} — actions: ${actions} — stop: ${result.stopReason}${err}`;
}
