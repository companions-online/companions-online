import { bootstrapHarness, type Bootstrap, type BootstrapOpts } from './bootstrap.js';
import type { ChatMessage, TokenUsage } from './openrouter.js';
import type { ToolCall, DispatchResult } from './dispatcher.js';
import type { RateTracker } from './rate-tracker.js';

export type StopReason = 'aborted' | 'max_steps' | 'host_stop' | 'completed';

export interface VariantResult {
  stepCount: number;
  stopReason: StopReason;
}

/**
 * Mutable token accumulator threaded from the CLI through the runner. The
 * CLI prints from this object on every exit path (success / error / SIGINT),
 * so the runner mutates fields in place rather than returning a snapshot.
 */
export interface UsageAccumulator {
  prompt: number;
  completion: number;
  total: number;
  /** Cumulative dollars billed (sum of `usage.cost` per turn; 0 when provider doesn't report cost). */
  costUsd: number;
  /** Count of MCP tool calls dispatched (game actions). Harness-local tools excluded. */
  mcpCalls: number;
  /** Wall-clock ms when this accumulator was created — anchor for cumulative APS. */
  startedAtMs: number;
}

/** Cumulative actions/sec (MCP calls per second since the accumulator was created). */
export function computeAps(u: UsageAccumulator, nowMs: number = Date.now()): number {
  const elapsedMs = Math.max(1, nowMs - u.startedAtMs);
  return (u.mcpCalls * 1000) / elapsedMs;
}

/**
 * Post-turn hook context. The runner already has `lastToolName` /
 * `lastInlineText` as locals when calling this hook, so handing them over
 * lets the multi-character dashboard render the current action without
 * tailing the JSONL log.
 */
export interface TurnCompleteCtx {
  step: number;
  usage?: TokenUsage;
  lastToolName?: string;
  lastInlineText?: string;
}

export interface RunVariantOpts extends BootstrapOpts {
  /** Test-only cap. Production run is unbounded. */
  maxSteps?: number;
  abortSignal?: AbortSignal;
  /** Called after each turn. Return 'stop' to end the loop early. */
  onTurnComplete?: (ctx: TurnCompleteCtx) => void | 'stop' | Promise<void | 'stop'>;
  /** Mutable accumulator updated each turn from the decider's reported usage. */
  usage?: UsageAccumulator;
  /** Trailing-window completion-token tracker, pushed once per turn for live tps display. */
  rate?: RateTracker;
}

export interface ToolResultCtx {
  step: number;
  call: ToolCall;
  dispatched: DispatchResult;
  inlineText: string;
  assistantMsg: ChatMessage;
  usage?: TokenUsage;
}

export interface NoToolCallCtx {
  step: number;
  inlineText: string;
  assistantMsg: ChatMessage;
  usage?: TokenUsage;
}

export interface VariantStrategy<S> {
  initialize(b: Bootstrap): S;
  buildMessages(state: S, memory: string): ChatMessage[];
  onToolResult(state: S, ctx: ToolResultCtx): void | Promise<void>;
  onNoToolCall(state: S, ctx: NoToolCallCtx): void | Promise<void>;
}

function shortText(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

export async function runHarness<S>(
  strategy: VariantStrategy<S>,
  opts: RunVariantOpts,
): Promise<VariantResult> {
  const b = await bootstrapHarness(opts);
  const { mcp, dispatcher, decider, memory, log } = b;
  const state = strategy.initialize(b);

  let stepCount = 0;
  let stopReason: StopReason = 'completed';

  while (true) {
    if (opts.abortSignal?.aborted) { stopReason = 'aborted'; break; }
    if (opts.maxSteps !== undefined && stepCount >= opts.maxSteps) { stopReason = 'max_steps'; break; }
    stepCount++;

    const messages = strategy.buildMessages(state, memory.read());
    const tools = dispatcher.buildOpenAITools();
    log.event('request', { step: stepCount, messages, tools });

    let result;
    try {
      result = await decider.decide({ messages, tools });
    } catch (e) {
      log.event('decider_error', { step: stepCount, error: String((e as Error).message ?? e) });
      throw e;
    }
    const { message: assistantMsg, usage } = result;
    log.event('response', { step: stepCount, assistantMsg, usage });

    if (opts.usage && usage) {
      if (usage.prompt_tokens) opts.usage.prompt += usage.prompt_tokens;
      if (usage.completion_tokens) opts.usage.completion += usage.completion_tokens;
      if (usage.total_tokens) opts.usage.total += usage.total_tokens;
      if (usage.cost) opts.usage.costUsd += usage.cost;
    }
    opts.rate?.push(usage?.completion_tokens ?? 0);

    const inlineText = assistantMsg.content ?? '';
    if (inlineText) log.stdout(`assistant: ${shortText(inlineText)}`);

    const calls = assistantMsg.tool_calls ?? [];
    let lastToolName: string | undefined;
    if (calls.length === 0) {
      log.stdout(`assistant: (no tool call)`);
      await strategy.onNoToolCall(state, { step: stepCount, inlineText, assistantMsg, usage });
    } else {
      const call = calls[0] as ToolCall;
      lastToolName = call.function.name;
      log.stdout(`tool: ${call.function.name}(${call.function.arguments ?? ''})`);
      log.event('tool_call', { step: stepCount, call });

      let dispatched: DispatchResult;
      try {
        dispatched = await dispatcher.dispatch(call);
      } catch (e) {
        const errText = String((e as Error).message ?? e);
        log.event('tool_error', { step: stepCount, call, error: errText });
        dispatched = { text: `ERROR: ${errText}`, raw: null, isError: true, kind: 'mcp' };
      }
      log.event('tool_result', { step: stepCount, callId: call.id, result: dispatched });

      if (opts.usage && dispatched.kind === 'mcp') opts.usage.mcpCalls++;

      await strategy.onToolResult(state, { step: stepCount, call, dispatched, inlineText, assistantMsg, usage });
    }

    if (opts.onTurnComplete) {
      const verdict = await opts.onTurnComplete({
        step: stepCount,
        usage,
        lastToolName,
        lastInlineText: inlineText || undefined,
      });
      if (verdict === 'stop') { stopReason = 'host_stop'; break; }
    }
  }

  await mcp.close();
  log.close();
  return { stepCount, stopReason };
}
