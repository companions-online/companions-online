import { describe, it, expect } from 'vitest';
import { HumanDecider } from '../human-harness.js';
import type { UI, ToolPick } from '../human-ui.js';
import type { OpenAITool } from '../tools.js';

function scripted(picks: ToolPick[], params: Record<string, unknown>[]): UI {
  let p = 0, q = 0;
  return {
    pickTool: async () => picks[p++],
    promptParams: async () => params[q++],
    readLine: async () => '',
    close: () => {},
  };
}

const addTool: OpenAITool = {
  type: 'function',
  function: {
    name: 'add',
    description: 'add two numbers',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
  },
};

describe('HumanDecider', () => {
  it('returns an assistant tool_call after a tool pick', async () => {
    const ui = scripted([{ kind: 'tool', tool: addTool }], [{ a: 1, b: 2 }]);
    const d = new HumanDecider(ui);
    const { message: msg } = await d.decide({ messages: [], tools: [addTool] });
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBeNull();
    expect(msg.tool_calls?.[0].function.name).toBe('add');
    expect(msg.tool_calls?.[0].function.arguments).toBe(JSON.stringify({ a: 1, b: 2 }));
  });

  it('captures inline say before the tool pick', async () => {
    const ui = scripted(
      [{ kind: 'inline', text: 'I am thinking' }, { kind: 'tool', tool: addTool }],
      [{ a: 7, b: 8 }],
    );
    const d = new HumanDecider(ui);
    const { message: msg } = await d.decide({ messages: [], tools: [addTool] });
    expect(msg.content).toBe('I am thinking');
    expect(msg.tool_calls?.[0].function.arguments).toBe(JSON.stringify({ a: 7, b: 8 }));
  });
});
