import { bootstrapHarness } from './bootstrap.js';
import type { ChatMessage } from './openrouter.js';
import type { ToolCall } from './tools.js';
import type { RunVariantOpts, VariantResult, StopReason } from './compact.js';

const KEEP_RECENT_TURNS = 2;

function shortText(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

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
 * `player_say` and `entity_died` substrings (these typically appear in MCP
 * narration / event blocks). Returns an array of short hints; empty if none.
 */
export function extractKeyEvents(text: string): string[] {
  const out: string[] = [];
  // Match "player_say" with following content like quoted message.
  const says = text.matchAll(/player_say[^\n]{0,160}/g);
  for (const m of says) out.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 120));
  const deaths = text.matchAll(/entity_died[^\n]{0,160}/g);
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

function compactTurnLine(turn: Turn): string {
  const calls = turn.assistant.tool_calls ?? [];
  if (calls.length === 0) {
    const inline = turn.assistant.content;
    const said = typeof inline === 'string' && inline ? `said: ${JSON.stringify(shortText(inline))}` : '(no tool call)';
    return said;
  }
  const call = calls[0];
  const name = call.function.name;
  const args = call.function.arguments ?? '{}';
  const result = typeof turn.tool?.content === 'string' ? turn.tool.content : '';
  const action = extractActionTag(result);
  const events = extractKeyEvents(result);
  const tail = events.length > 0 ? `; events:[${events.join(', ')}]` : '';
  const summary = action ?? shortText(result, 80);
  return `${name}(${args}) → ${summary}${tail}`;
}

/**
 * Replace turns older than the most recent `keepRecent` with a single user
 * message summarizing each. Returns a new flattened message array.
 */
export function compactOldTurns(messages: ChatMessage[], keepRecent = KEEP_RECENT_TURNS): ChatMessage[] {
  const { prefix, turns } = splitTurns(messages);
  if (turns.length <= keepRecent) return messages;
  const cutoff = turns.length - keepRecent;
  const out: ChatMessage[] = [...prefix];
  for (let i = 0; i < cutoff; i++) {
    out.push({ role: 'user', content: compactTurnLine(turns[i]) });
  }
  for (let i = cutoff; i < turns.length; i++) {
    out.push(turns[i].assistant);
    if (turns[i].tool) out.push(turns[i].tool!);
    if (turns[i].trailingUser) out.push(turns[i].trailingUser!);
  }
  return out;
}

/**
 * Truncated harness: full history, but turns older than the last 2 are
 * collapsed to a single user line per turn: `tool(args) → <action>; events:[…]`.
 */
export async function runTruncated(opts: RunVariantOpts): Promise<VariantResult> {
  const { system, first, mcp, dispatcher, decider, memory, log } = await bootstrapHarness(opts);

  const messages: ChatMessage[] = [
    { role: 'system', content: renderSystem(system, memory.read()) },
    { role: 'user', content: first },
  ];

  let stepCount = 0;
  let stopReason: StopReason = 'completed';

  while (true) {
    if (opts.abortSignal?.aborted) { stopReason = 'aborted'; break; }
    if (opts.maxSteps !== undefined && stepCount >= opts.maxSteps) { stopReason = 'max_steps'; break; }
    stepCount++;

    messages[0] = { role: 'system', content: renderSystem(system, memory.read()) };
    const compacted = compactOldTurns(messages);

    const tools = dispatcher.buildOpenAITools();
    log.event('request', { step: stepCount, messages: compacted, tools });

    let result;
    try {
      result = await decider.decide({ messages: compacted, tools });
    } catch (e) {
      log.event('decider_error', { step: stepCount, error: String((e as Error).message ?? e) });
      throw e;
    }
    const { message: assistantMsg, usage } = result;
    log.event('response', { step: stepCount, assistantMsg, usage });

    const inlineText = assistantMsg.content ?? '';
    if (inlineText) log.stdout(`assistant: ${shortText(inlineText)}`);

    messages.push(assistantMsg);

    const calls = assistantMsg.tool_calls ?? [];
    if (calls.length === 0) {
      log.stdout(`assistant: (no tool call)`);
      messages.push({ role: 'user', content: 'continue' });
    } else {
      const call = calls[0] as ToolCall;
      log.stdout(`tool: ${call.function.name}(${call.function.arguments ?? ''})`);
      log.event('tool_call', { step: stepCount, call });

      let dispatched;
      try {
        dispatched = await dispatcher.dispatch(call);
      } catch (e) {
        const errText = String((e as Error).message ?? e);
        log.event('tool_error', { step: stepCount, call, error: errText });
        dispatched = { text: `ERROR: ${errText}`, raw: null, isError: true, kind: 'mcp' as const };
      }
      log.event('tool_result', { step: stepCount, callId: call.id, result: dispatched });

      messages.push({ role: 'tool', tool_call_id: call.id, content: dispatched.text });
      messages.push({ role: 'user', content: 'continue' });
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

async function cli(): Promise<void> {
  const configName = process.argv[2];
  if (!configName) {
    console.error('usage: tsx harness/truncated.ts <config-name>');
    process.exit(1);
  }
  const ac = new AbortController();
  process.on('SIGINT', () => {
    console.error('\n[truncated] SIGINT — shutting down');
    ac.abort();
  });
  await runTruncated({ configName, abortSignal: ac.signal });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
