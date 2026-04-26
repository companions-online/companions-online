import { bootstrapHarness } from './bootstrap.js';
import type { ChatMessage } from './openrouter.js';
import type { ToolCall } from './tools.js';
import type { RunVariantOpts, VariantResult, StopReason } from './compact.js';

function shortText(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function renderSystem(systemPrompt: string, memory: string): string {
  const parts = [systemPrompt.trim(), '## Memory', memory.trim() || '(empty)'];
  return parts.join('\n\n');
}

/**
 * Baseline harness: full message history, no truncation. After every tool
 * response we ping with `user: "continue"` so the model keeps acting. The
 * system message is rebuilt each turn so memory edits via memory_update
 * are reflected immediately.
 */
export async function runBaseline(opts: RunVariantOpts): Promise<VariantResult> {
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

    // Refresh system message with current memory (in-place; index 0 is always system).
    messages[0] = { role: 'system', content: renderSystem(system, memory.read()) };

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
    console.error('usage: tsx harness/baseline.ts <config-name>');
    process.exit(1);
  }
  const ac = new AbortController();
  process.on('SIGINT', () => {
    console.error('\n[baseline] SIGINT — shutting down');
    ac.abort();
  });
  await runBaseline({ configName, abortSignal: ac.signal });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cli().catch(e => { console.error(e); process.exit(1); });
}
