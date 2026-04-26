import { bootstrapHarness, type Bootstrap, type BootstrapOpts } from './bootstrap.js';
import type { ChatMessage, TokenUsage } from './openrouter.js';
import type { ToolCall, DispatchResult } from './dispatcher.js';

export type StopReason = 'aborted' | 'max_steps' | 'host_stop' | 'completed';

export interface VariantResult {
  stepCount: number;
  stopReason: StopReason;
}

export interface RunVariantOpts extends BootstrapOpts {
  /** Test-only cap. Production run is unbounded. */
  maxSteps?: number;
  abortSignal?: AbortSignal;
  /** Called after each turn. Return 'stop' to end the loop early. */
  onTurnComplete?: (step: number, usage?: TokenUsage) => void | 'stop' | Promise<void | 'stop'>;
}

export interface ToolResultCtx {
  step: number;
  call: ToolCall;
  dispatched: DispatchResult;
  inlineText: string;
  assistantMsg: ChatMessage;
}

export interface NoToolCallCtx {
  step: number;
  inlineText: string;
  assistantMsg: ChatMessage;
}

export interface VariantStrategy<S> {
  initialize(b: Bootstrap): S;
  buildMessages(state: S, memory: string): ChatMessage[];
  onToolResult(state: S, ctx: ToolResultCtx): void;
  onNoToolCall(state: S, ctx: NoToolCallCtx): void;
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

    const inlineText = assistantMsg.content ?? '';
    if (inlineText) log.stdout(`assistant: ${shortText(inlineText)}`);

    const calls = assistantMsg.tool_calls ?? [];
    if (calls.length === 0) {
      log.stdout(`assistant: (no tool call)`);
      strategy.onNoToolCall(state, { step: stepCount, inlineText, assistantMsg });
    } else {
      const call = calls[0] as ToolCall;
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

      strategy.onToolResult(state, { step: stepCount, call, dispatched, inlineText, assistantMsg });
    }

    if (opts.onTurnComplete) {
      const verdict = await opts.onTurnComplete(stepCount, usage);
      if (verdict === 'stop') { stopReason = 'host_stop'; break; }
    }
  }

  await mcp.close();
  log.close();
  return { stepCount, stopReason };
}
