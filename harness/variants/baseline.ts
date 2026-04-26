import type { ChatMessage } from '../helpers/openrouter.js';
import type { Bootstrap } from '../helpers/bootstrap.js';
import { runHarness, type VariantStrategy, type RunVariantOpts, type VariantResult } from '../helpers/runner.js';

export type { RunVariantOpts, VariantResult, StopReason } from '../helpers/runner.js';

interface BaselineState {
  system: string;
  messages: ChatMessage[];
}

function renderSystem(systemPrompt: string, memory: string): string {
  const parts = [systemPrompt.trim(), '## Memory', memory.trim() || '(empty)'];
  return parts.join('\n\n');
}

const baselineStrategy: VariantStrategy<BaselineState> = {
  initialize(b: Bootstrap): BaselineState {
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
    return state.messages;
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
 * Baseline harness: full message history, no truncation. After every tool
 * response we ping with `user: "continue"` so the model keeps acting. The
 * system message is rebuilt each turn so memory edits via memory_update
 * are reflected immediately.
 */
export async function runBaseline(opts: RunVariantOpts): Promise<VariantResult> {
  return runHarness(baselineStrategy, opts);
}
