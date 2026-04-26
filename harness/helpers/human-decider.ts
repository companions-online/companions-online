import type { ChatMessage } from './openrouter.js';
import type { Decider, DecideInput, DecideResult } from './decider.js';
import type { UI } from './human-ui.js';

export class HumanDecider implements Decider {
  private turn = 0;
  constructor(private readonly ui: UI) {}

  async decide({ messages, tools }: DecideInput): Promise<DecideResult> {
    this.turn++;
    printMessages(messages);

    let inlineText = '';
    // Menu loop: inline-say selections re-open the menu; a tool selection returns.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pick = await this.ui.pickTool(tools);
      if (pick.kind === 'inline') { inlineText = pick.text; continue; }

      const params = await this.ui.promptParams(pick.tool);
      const message: ChatMessage = {
        role: 'assistant',
        content: inlineText || null,
        tool_calls: [{
          id: `human_${this.turn}`,
          type: 'function',
          function: {
            name: pick.tool.function.name,
            arguments: JSON.stringify(params),
          },
        }],
      };
      return { message };
    }
  }
}

function printMessages(messages: ChatMessage[]): void {
  const stdout = process.stdout;
  stdout.write('\n' + '='.repeat(70) + '\n');
  stdout.write('PROMPT (what the model would see)\n');
  stdout.write('='.repeat(70) + '\n');
  for (const m of messages) {
    stdout.write(`\n--- ${m.role.toUpperCase()} ---\n`);
    if (m.content) stdout.write(m.content + '\n');
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        stdout.write(`[tool_call ${tc.id}] ${tc.function.name}(${tc.function.arguments})\n`);
      }
    }
    if (m.tool_call_id) stdout.write(`(response to ${m.tool_call_id})\n`);
  }
  stdout.write('\n' + '='.repeat(70) + '\n');
}

