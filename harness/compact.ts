import { bootstrapHarness, type BootstrapOpts } from './bootstrap.js';
import type { ChatMessage, TokenUsage } from './openrouter.js';
import type { ToolCall } from './tools.js';

// --- State ---

export interface ActionEntry {
  step: number;
  inlineText: string;
  tool: string;
  args: unknown;
  result: string;
}

export interface RecordedCall {
  tool: string;
  args: unknown;
  result: string;
}

export interface PendingCall {
  id: string;
  name: string;
  argumentsJson: string;
  inlineText: string;
  result: string;
  reasoningDetails?: unknown;
}

export interface CompactState {
  systemPrompt: string;
  firstMessage: string;
  actionWindow: ActionEntry[];
  actionWindowSize: number;
  lastPerception: RecordedCall | null;
  pendingCall: PendingCall | null;
  stepCount: number;
}

export function createCompactState(opts: {
  systemPrompt: string;
  firstMessage: string;
  actionWindowSize?: number;
}): CompactState {
  return {
    systemPrompt: opts.systemPrompt,
    firstMessage: opts.firstMessage,
    actionWindow: [],
    actionWindowSize: opts.actionWindowSize ?? 20,
    lastPerception: null,
    pendingCall: null,
    stepCount: 0,
  };
}

export function isPerception(result: string): boolean {
  return result.includes('<map>');
}

export function recordTurn(
  state: CompactState,
  entry: ActionEntry,
  opts: { kind: 'mcp' | 'harness' } = { kind: 'mcp' },
): void {
  state.actionWindow.push(entry);
  while (state.actionWindow.length > state.actionWindowSize) state.actionWindow.shift();
  if (opts.kind === 'mcp' && isPerception(entry.result)) {
    state.lastPerception = { tool: entry.tool, args: entry.args, result: entry.result };
  }
}

// --- Prompt building ---

export function buildMessages(input: { state: CompactState; memory: string }): ChatMessage[] {
  const { state, memory } = input;
  const system: ChatMessage = { role: 'system', content: renderSystem(state, memory) };
  if (!state.pendingCall) {
    return [system, { role: 'user', content: state.firstMessage }];
  }
  const pc = state.pendingCall;
  const assistant: ChatMessage = {
    role: 'assistant',
    content: pc.inlineText || null,
    tool_calls: [{ id: pc.id, type: 'function', function: { name: pc.name, arguments: pc.argumentsJson } }],
    ...(pc.reasoningDetails !== undefined ? { reasoning_details: pc.reasoningDetails } : {}),
  };
  const tool: ChatMessage = { role: 'tool', tool_call_id: pc.id, content: pc.result };
  return [system, assistant, tool];
}

function renderSystem(state: CompactState, memory: string): string {
  const parts: string[] = [state.systemPrompt.trim()];
  parts.push('## Memory');
  parts.push(memory.trim() || '(empty)');
  parts.push('## Recent actions (last N)');
  if (state.actionWindow.length === 0) parts.push('(none yet)');
  else parts.push(state.actionWindow.map(renderActionEntry).join('\n'));
  if (state.lastPerception) {
    parts.push('## Last perception (full)');
    parts.push(renderRecordedCall(state.lastPerception));
  }
  return parts.join('\n\n');
}

function renderActionEntry(e: ActionEntry): string {
  const said = e.inlineText ? `said: ${JSON.stringify(e.inlineText)}\n    ` : '';
  return `[${e.step}] ${said}→ ${e.tool}(${stringifyArgs(e.args)}) → ${abbreviateResult(e.result)}`;
}

export function abbreviateResult(result: string): string {
  const m = result.match(/<action\b[^>]*>[\s\S]*?<\/action>/);
  if (m) return oneLine(m[0]);
  return oneLine(result);
}

function renderRecordedCall(c: RecordedCall): string {
  return `tool: ${c.tool}(${stringifyArgs(c.args)}) →\n${c.result}`;
}

function stringifyArgs(args: unknown): string {
  try { return JSON.stringify(args); } catch { return String(args); }
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// --- Loop ---

export interface RunVariantOpts extends BootstrapOpts {
  /** Test-only cap. Production run is unbounded. */
  maxSteps?: number;
  abortSignal?: AbortSignal;
  /** Called after each turn. Return 'stop' to end the loop early. */
  onTurnComplete?: (step: number, usage?: TokenUsage) => void | 'stop' | Promise<void | 'stop'>;
}

export type StopReason = 'aborted' | 'max_steps' | 'host_stop' | 'completed';

export interface VariantResult {
  stepCount: number;
  stopReason: StopReason;
}

function shortText(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

export async function runCompact(opts: RunVariantOpts): Promise<VariantResult> {
  const { config, system, first, mcp, dispatcher, decider, memory, log } = await bootstrapHarness(opts);

  const state = createCompactState({
    systemPrompt: system,
    firstMessage: first,
    actionWindowSize: config.actionWindowSize ?? 20,
  });

  let stopReason: StopReason = 'completed';

  while (true) {
    if (opts.abortSignal?.aborted) { stopReason = 'aborted'; break; }
    if (opts.maxSteps !== undefined && state.stepCount >= opts.maxSteps) { stopReason = 'max_steps'; break; }
    state.stepCount++;

    const messages = buildMessages({ state, memory: memory.read() });
    const tools = dispatcher.buildOpenAITools();
    log.event('request', { step: state.stepCount, messages, tools });

    let result;
    try {
      result = await decider.decide({ messages, tools });
    } catch (e) {
      log.event('decider_error', { step: state.stepCount, error: String((e as Error).message ?? e) });
      throw e;
    }
    const { message: assistantMsg, usage } = result;
    log.event('response', { step: state.stepCount, assistantMsg, usage });

    const inlineText = assistantMsg.content ?? '';
    if (inlineText) log.stdout(`assistant: ${shortText(inlineText)}`);

    const calls = assistantMsg.tool_calls ?? [];
    if (calls.length === 0) {
      log.stdout(`assistant: (no tool call)`);
      recordTurn(state, {
        step: state.stepCount, inlineText,
        tool: '(none)', args: {},
        result: '(no tool call emitted)',
      });
      state.pendingCall = null;
    } else {
      const call = calls[0] as ToolCall;
      let argsParsed: unknown = {};
      try { argsParsed = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { /* keep {} */ }
      log.stdout(`tool: ${call.function.name}(${call.function.arguments ?? ''})`);
      log.event('tool_call', { step: state.stepCount, call });

      let dispatched;
      try {
        dispatched = await dispatcher.dispatch(call);
      } catch (e) {
        const errText = String((e as Error).message ?? e);
        log.event('tool_error', { step: state.stepCount, call, error: errText });
        dispatched = { text: `ERROR: ${errText}`, raw: null, isError: true, kind: 'mcp' as const };
      }
      log.event('tool_result', { step: state.stepCount, callId: call.id, result: dispatched });

      recordTurn(state, {
        step: state.stepCount, inlineText,
        tool: call.function.name, args: argsParsed,
        result: dispatched.text,
      }, { kind: dispatched.kind });

      state.pendingCall = {
        id: call.id, name: call.function.name,
        argumentsJson: call.function.arguments ?? '{}',
        inlineText, result: dispatched.text,
        reasoningDetails: assistantMsg.reasoning_details,
      };
    }

    if (opts.onTurnComplete) {
      const verdict = await opts.onTurnComplete(state.stepCount, usage);
      if (verdict === 'stop') { stopReason = 'host_stop'; break; }
    }
  }

  await mcp.close();
  log.close();
  return { stepCount: state.stepCount, stopReason };
}

async function cli(): Promise<void> {
  const configName = process.argv[2];
  if (!configName) {
    console.error('usage: tsx harness/compact.ts <config-name>');
    process.exit(1);
  }
  const ac = new AbortController();
  process.on('SIGINT', () => {
    console.error('\n[harness] SIGINT — shutting down');
    ac.abort();
  });
  await runCompact({ configName, abortSignal: ac.signal });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
