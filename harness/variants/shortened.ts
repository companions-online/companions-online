import type { Bootstrap } from '../helpers/bootstrap.js';
import type { ChatMessage } from '../helpers/openrouter.js';
import { runHarness, type VariantStrategy, type RunVariantOpts, type VariantResult } from '../helpers/runner.js';

export type { RunVariantOpts, VariantResult, StopReason } from '../helpers/runner.js';

const KEEP_RECENT_TURNS = 2;

function renderSystem(systemPrompt: string, memory: string): string {
  const parts = [systemPrompt.trim(), '## Memory', memory.trim() || '(empty)'];
  return parts.join('\n\n');
}

export function extractActionTag(text: string): string | null {
  const m = text.match(/<action\b[^>]*>[\s\S]*?<\/action>/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Pluck noteworthy event mentions from a tool result text. We look for
 * ` said ` and ` died` substrings (these typically appear in MCP narration —
 * e.g. "Alice said hi", "Wolf died"). Returns an array of short hints; empty
 * if none.
 */
export function extractKeyEvents(text: string): string[] {
  const out: string[] = [];
  const says = text.matchAll(/ said [^\n]{0,160}/g);
  for (const m of says) out.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 120));
  const deaths = text.matchAll(/ died[^\n]{0,160}/g);
  for (const m of deaths) out.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 120));
  return out;
}

interface Turn {
  assistant: ChatMessage;
  tool?: ChatMessage;
  trailingUser?: ChatMessage;
}

/**
 * Split the message array (excluding the leading system + first user) into
 * turns. A turn = one assistant message + (optional matching tool message) +
 * (optional `user: continue` ping). The leading [system, user] prefix is
 * returned alongside.
 */
function splitTurns(messages: ChatMessage[]): { prefix: ChatMessage[]; turns: Turn[] } {
  const prefix: ChatMessage[] = [];
  let i = 0;
  if (messages[i]?.role === 'system') prefix.push(messages[i++]);
  if (messages[i]?.role === 'user') prefix.push(messages[i++]);

  const turns: Turn[] = [];
  while (i < messages.length) {
    if (messages[i].role !== 'assistant') { i++; continue; }
    const turn: Turn = { assistant: messages[i++] };
    if (i < messages.length && messages[i].role === 'tool') {
      turn.tool = messages[i++];
    }
    if (i < messages.length && messages[i].role === 'user') {
      turn.trailingUser = messages[i++];
    }
    turns.push(turn);
  }
  return { prefix, turns };
}

/**
 * Build the collapsed line for a single turn. Composes (verbatim, no
 * truncation) any of: assistant inline content, assistant reasoning wrapped
 * in <thinking>, and the tool call summary `name(args) → <action>; events:[…]`.
 */
function compactTurnLine(turn: Turn): string {
  const parts: string[] = [];

  const inline = typeof turn.assistant.content === 'string' ? turn.assistant.content : '';
  if (inline) parts.push(inline);

  const reasoning = typeof turn.assistant.reasoning === 'string' ? turn.assistant.reasoning : '';
  if (reasoning) parts.push(`<thinking>${reasoning}</thinking>`);

  const calls = turn.assistant.tool_calls ?? [];
  if (calls.length > 0) {
    const call = calls[0];
    const name = call.function.name;
    const args = call.function.arguments ?? '{}';
    const result = typeof turn.tool?.content === 'string' ? turn.tool.content : '';
    const action = extractActionTag(result);
    const events = extractKeyEvents(result);
    const tail = events.length > 0 ? `; events:[${events.join(', ')}]` : '';
    const summary = action ?? result;
    parts.push(`${name}(${args}) → ${summary}${tail}`);
  }

  return parts.length > 0 ? parts.join('\n') : '(no tool call)';
}

/**
 * Replace turns older than the most recent `keepRecent` with a single
 * assistant message summarizing each. Returns a new flattened message array.
 */
export function compactOldTurns(messages: ChatMessage[], keepRecent = KEEP_RECENT_TURNS): ChatMessage[] {
  const { prefix, turns } = splitTurns(messages);
  if (turns.length <= keepRecent) return messages;
  const cutoff = turns.length - keepRecent;
  const out: ChatMessage[] = [...prefix];
  for (let i = 0; i < cutoff; i++) {
    out.push({ role: 'assistant', content: compactTurnLine(turns[i]) });
  }
  for (let i = cutoff; i < turns.length; i++) {
    out.push(turns[i].assistant);
    if (turns[i].tool) out.push(turns[i].tool!);
    if (turns[i].trailingUser) out.push(turns[i].trailingUser!);
  }
  return out;
}

// --- Strategy ---

interface ShortenedState {
  system: string;
  messages: ChatMessage[];
}

const shortenedStrategy: VariantStrategy<ShortenedState> = {
  initialize(b: Bootstrap): ShortenedState {
    return {
      system: b.system,
      messages: [
        { role: 'system', content: renderSystem(b.system, b.memory.read()) },
        { role: 'user', content: b.first },
      ],
    };
  },

  buildMessages(state, memory) {
    state.messages[0] = { role: 'system', content: renderSystem(state.system, memory) };
    return compactOldTurns(state.messages);
  },

  onNoToolCall(state, { assistantMsg }) {
    state.messages.push(assistantMsg);
    state.messages.push({ role: 'user', content: 'continue' });
  },

  onToolResult(state, { call, dispatched, assistantMsg }) {
    state.messages.push(assistantMsg);
    state.messages.push({ role: 'tool', tool_call_id: call.id, content: dispatched.text });
  },
};

/**
 * Shortened harness: full history, but turns older than the last 2 are
 * collapsed to a single assistant message containing the assistant's verbatim
 * inline text + reasoning + tool call summary `tool(args) → <action>; events:[…]`.
 */
export async function runShortened(opts: RunVariantOpts): Promise<VariantResult> {
  return runHarness(shortenedStrategy, opts);
}
