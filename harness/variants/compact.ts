import type { Bootstrap } from '../helpers/bootstrap.js';
import type { ChatMessage } from '../helpers/openrouter.js';
import { runHarness, type VariantStrategy, type RunVariantOpts, type VariantResult } from '../helpers/runner.js';

export type { RunVariantOpts, VariantResult, StopReason } from '../helpers/runner.js';

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

// --- Strategy ---

const compactStrategy: VariantStrategy<CompactState> = {
  initialize(b: Bootstrap): CompactState {
    return createCompactState({
      systemPrompt: b.system,
      firstMessage: b.first,
      actionWindowSize: b.config.actionWindowSize ?? 20,
    });
  },

  buildMessages(state, memory) {
    return buildMessages({ state, memory });
  },

  onNoToolCall(state, { step, inlineText }) {
    recordTurn(state, {
      step, inlineText,
      tool: '(none)', args: {},
      result: '(no tool call emitted)',
    });
    state.pendingCall = null;
    state.stepCount = step;
  },

  onToolResult(state, { step, call, dispatched, inlineText, assistantMsg }) {
    let argsParsed: unknown = {};
    try { argsParsed = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { /* keep {} */ }

    recordTurn(state, {
      step, inlineText,
      tool: call.function.name, args: argsParsed,
      result: dispatched.text,
    }, { kind: dispatched.kind });

    state.pendingCall = {
      id: call.id, name: call.function.name,
      argumentsJson: call.function.arguments ?? '{}',
      inlineText, result: dispatched.text,
      reasoningDetails: assistantMsg.reasoning_details,
    };
    state.stepCount = step;
  },
};

export async function runCompact(opts: RunVariantOpts): Promise<VariantResult> {
  return runHarness(compactStrategy, opts);
}
