import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Bootstrap, ModelConfig } from '../helpers/bootstrap.js';
import type { ChatMessage, TokenUsage } from '../helpers/openrouter.js';
import { OpenRouterClient } from '../helpers/openrouter.js';
import { OpenRouterDecider, type Decider } from '../helpers/decider.js';
import { loadEnv } from '../helpers/env.js';
import { CONFIG_DIR, LOGS_DIR } from '../helpers/paths.js';
import {
  runHarness,
  type VariantStrategy,
  type RunVariantOpts,
  type VariantResult,
} from '../helpers/runner.js';

export type { RunVariantOpts, VariantResult, StopReason } from '../helpers/runner.js';

/**
 * Default prompt-token ceiling. When `usage.prompt_tokens` hits this after a
 * turn, the variant runs one compaction pass and resets the conversation to
 * `[system, user(first), assistant(recap), user("continue")]`.
 *
 * Override per-model by adding `"incrementalCompactionMaxTokens": <n>` to the
 * model config JSON.
 */
export const DEFAULT_MAX_TOKENS = 30_000;

const COMPACTION_PROMPT_FILE = 'compaction-prompt.md';

interface IncrementalCompactionState {
  system: string;
  first: string;
  messages: ChatMessage[];
  decider: Decider;
  maxTokens: number;
  compactionSystem: string;
  compactionFinalUser: string;
  modelLabel: string;
}

function renderSystem(systemPrompt: string, memory: string): string {
  const parts = [systemPrompt.trim(), '## Memory', memory.trim() || '(empty)'];
  return parts.join('\n\n');
}

function loadCompactionPrompt(configDir: string = CONFIG_DIR): {
  compactionSystem: string;
  compactionFinalUser: string;
} {
  const raw = readFileSync(join(configDir, COMPACTION_PROMPT_FILE), 'utf8');
  const idx = raw.indexOf('\n---\n');
  if (idx === -1) {
    throw new Error(`${COMPACTION_PROMPT_FILE} must contain "\\n---\\n" splitting system from final user prompt`);
  }
  return {
    compactionSystem: raw.slice(0, idx).trim(),
    compactionFinalUser: raw.slice(idx + 5).trim(),
  };
}

function resolveMaxTokens(config: ModelConfig): number {
  const v = (config as { incrementalCompactionMaxTokens?: unknown }).incrementalCompactionMaxTokens;
  return typeof v === 'number' && v > 0 ? v : DEFAULT_MAX_TOKENS;
}

/**
 * Filter to assistant messages with non-empty string content. Drops reasoning,
 * tool_calls, and the tool/system/user messages around them. This is the
 * "content only" projection the compaction pass operates on.
 */
export function filterAssistantContent(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    out.push({ role: 'assistant', content });
  }
  return out;
}

export interface CompactMessagesArgs {
  messages: ChatMessage[];
  system: string;            // raw system prompt (no memory section appended)
  first: string;             // first user message
  memory: string;            // scratchpad text to splice into rebuilt system
  compactionSystem: string;
  compactionFinalUser: string;
  decider: Decider;
}

export interface CompactMessagesResult {
  compactedText: string;
  newMessages: ChatMessage[];
  filteredCount: number;
  usage?: TokenUsage;
}

/**
 * Pure compaction pass. Filters the prior history to assistant content, asks
 * the decider for a recap, and returns the rebuilt 4-message conversation.
 * No tools are passed to the decider — this is a pure summarization call.
 */
export async function compactMessages(args: CompactMessagesArgs): Promise<CompactMessagesResult> {
  const filtered = filterAssistantContent(args.messages);
  const compactionRequest: ChatMessage[] = [
    { role: 'system', content: args.compactionSystem },
    ...filtered,
    { role: 'user', content: args.compactionFinalUser },
  ];

  const { message, usage } = await args.decider.decide({ messages: compactionRequest, tools: [] });
  const compactedText = (typeof message.content === 'string' ? message.content : '').trim();

  const newMessages: ChatMessage[] = [
    { role: 'system', content: renderSystem(args.system, args.memory) },
    { role: 'user', content: args.first },
    { role: 'assistant', content: compactedText },
    { role: 'user', content: 'continue' },
  ];

  return { compactedText, newMessages, filteredCount: filtered.length, usage };
}

async function maybeCompact(
  state: IncrementalCompactionState,
  usage: TokenUsage | undefined,
  memoryText: string,
  log: (line: string) => void,
): Promise<void> {
  const prompt = usage?.prompt_tokens ?? 0;
  if (prompt < state.maxTokens) return;

  log(`incremental-compaction: prompt_tokens=${prompt} >= max=${state.maxTokens} — compacting`);
  const before = state.messages.length;
  const { compactedText, newMessages, filteredCount, usage: compactionUsage } = await compactMessages({
    messages: state.messages,
    system: state.system,
    first: state.first,
    memory: memoryText,
    compactionSystem: state.compactionSystem,
    compactionFinalUser: state.compactionFinalUser,
    decider: state.decider,
  });
  state.messages = newMessages;
  log(
    `incremental-compaction: ${before} → ${newMessages.length} msgs (filtered ${filteredCount} assistant)` +
      `; recap=${compactedText.length} chars` +
      (compactionUsage ? `; tokens p=${compactionUsage.prompt_tokens} c=${compactionUsage.completion_tokens}` : ''),
  );
}

const incrementalCompactionStrategy: VariantStrategy<IncrementalCompactionState> = {
  initialize(b: Bootstrap): IncrementalCompactionState {
    const { compactionSystem, compactionFinalUser } = loadCompactionPrompt();
    return {
      system: b.system,
      first: b.first,
      decider: b.decider,
      maxTokens: resolveMaxTokens(b.config),
      compactionSystem,
      compactionFinalUser,
      modelLabel: b.config.model,
      messages: [
        { role: 'system', content: renderSystem(b.system, b.memory.read()) },
        { role: 'user', content: b.first },
      ],
    };
  },

  buildMessages(state, memory) {
    state.messages[0] = { role: 'system', content: renderSystem(state.system, memory) };
    return state.messages;
  },

  async onNoToolCall(state, { assistantMsg, usage }) {
    state.messages.push(assistantMsg);
    state.messages.push({ role: 'user', content: 'continue' });
    await maybeCompact(state, usage, '', (line) => process.stdout.write(`${line}\n`));
  },

  async onToolResult(state, { call, dispatched, assistantMsg, usage }) {
    state.messages.push(assistantMsg);
    state.messages.push({ role: 'tool', tool_call_id: call.id, content: dispatched.text });
    await maybeCompact(state, usage, '', (line) => process.stdout.write(`${line}\n`));
  },
};

/**
 * Incremental-compaction harness: full history (like baseline) until
 * `usage.prompt_tokens` hits MAX_TOKENS, then runs one LLM-driven compaction
 * pass that filters the conversation to assistant content, asks the same
 * model to recap, and restarts from `[system, first, recap, "continue"]`.
 *
 * Note: this variant deliberately reaches the decider from inside the
 * strategy — see `memory/harness/overview.md` "Hard rule". The exception is
 * documented: the variant *is* an in-loop model call, so this is its raison
 * d'être rather than leakage.
 */
export async function runIncrementalCompaction(opts: RunVariantOpts): Promise<VariantResult> {
  return runHarness(incrementalCompactionStrategy, opts);
}

// -----------------------------------------------------------------------------
// Direct-call test mode
//
// Usage: npx tsx harness/variants/incremental-compaction.ts <log-file-or-name>
//
// Reads the last `request` event from the given JSONL log, runs one
// compaction pass against the same model the run used, and prints the result.
// No MCP, no scratchpad — pure prompt-iteration tool.
// -----------------------------------------------------------------------------

function resolveLogPath(arg: string): string {
  const trimmed = arg.trim();
  if (isAbsolute(trimmed) && existsSync(trimmed)) return trimmed;
  const fromCwd = resolve(process.cwd(), trimmed);
  if ((trimmed.includes('/') || trimmed.endsWith('.jsonl')) && existsSync(fromCwd)) return fromCwd;
  const candidates = [
    join(LOGS_DIR, trimmed),
    join(LOGS_DIR, `${trimmed}.jsonl`),
    join(LOGS_DIR, `${trimmed}-log.jsonl`),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`log not found: tried ${[fromCwd, ...candidates].join(', ')}`);
}

interface ReplayedRun {
  configFromStart: ModelConfig | null;
  lastRequestMessages: ChatMessage[];
}

function readReplay(path: string): ReplayedRun {
  const raw = readFileSync(path, 'utf8');
  let configFromStart: ModelConfig | null = null;
  let lastRequestMessages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: { kind?: string; data?: unknown };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind === 'start' && entry.data && typeof entry.data === 'object') {
      const cfg = (entry.data as { config?: ModelConfig }).config;
      if (cfg) configFromStart = cfg;
    } else if (entry.kind === 'request' && entry.data && typeof entry.data === 'object') {
      const msgs = (entry.data as { messages?: ChatMessage[] }).messages;
      if (Array.isArray(msgs)) lastRequestMessages = msgs;
    }
  }
  return { configFromStart, lastRequestMessages };
}

function buildReplayDecider(config: ModelConfig): { decider: Decider; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set (check .env)');
  const { type: _t, model: _m, actionWindowSize: _a, ...extra } = config;
  const client = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });
  return { decider: new OpenRouterDecider(client, { model: config.model, ...extra }), model: config.model };
}

async function runDirectCall(arg: string): Promise<void> {
  loadEnv();
  const logPath = resolveLogPath(arg);
  const { configFromStart, lastRequestMessages } = readReplay(logPath);
  if (!configFromStart) throw new Error(`no \`start\` event with config found in ${logPath}`);
  if (lastRequestMessages.length === 0) throw new Error(`no \`request\` event with messages found in ${logPath}`);

  const systemMsg = lastRequestMessages.find((m) => m.role === 'system');
  const firstUserMsg = lastRequestMessages.find((m) => m.role === 'user');
  if (!systemMsg || typeof systemMsg.content !== 'string') throw new Error('last request has no system message');
  if (!firstUserMsg || typeof firstUserMsg.content !== 'string') throw new Error('last request has no user message');

  const { compactionSystem, compactionFinalUser } = loadCompactionPrompt();
  const { decider, model } = buildReplayDecider(configFromStart);

  const filteredPreview = filterAssistantContent(lastRequestMessages);
  process.stdout.write(
    `compaction replay\n` +
      `  log: ${logPath}\n` +
      `  model: ${model}\n` +
      `  input messages: ${lastRequestMessages.length}\n` +
      `  assistant-only filtered: ${filteredPreview.length}\n` +
      `  ----------------------------------------------------------------\n`,
  );

  const result = await compactMessages({
    messages: lastRequestMessages,
    system: systemMsg.content,
    first: firstUserMsg.content,
    memory: '',
    compactionSystem,
    compactionFinalUser,
    decider,
  });

  process.stdout.write(result.compactedText + '\n');
  process.stdout.write(
    `  ----------------------------------------------------------------\n` +
      `  recap: ${result.compactedText.length} chars` +
      (result.usage
        ? `; tokens p=${result.usage.prompt_tokens} c=${result.usage.completion_tokens} t=${result.usage.total_tokens}` +
          (result.usage.cost !== undefined ? `; cost=$${result.usage.cost.toFixed(6)}` : '')
        : '') +
      '\n',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write('usage: tsx harness/variants/incremental-compaction.ts <log-file-or-name>\n');
    process.exit(2);
  }
  runDirectCall(arg).catch((e) => {
    process.stderr.write(`error: ${(e as Error).message ?? e}\n`);
    process.exit(1);
  });
}
