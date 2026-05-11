import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestMcpServer, type TestMcpServerHandle } from './mcp-server.js';
import { createNoopLogger } from './noop-logger.js';
import { createCharacterRows, runCharacters } from '../../helpers/run-characters.js';
import type { Character } from '../../helpers/characters-config.js';
import type { Decider, DecideInput, DecideResult } from '../../helpers/decider.js';
import type { ChatMessage, TokenUsage } from '../../helpers/openrouter.js';

let mcp: TestMcpServerHandle | undefined;
let memDir: string | undefined;
const origMcpUrl = process.env.MCP_URL;

afterEach(async () => {
  await mcp?.close(); mcp = undefined;
  if (memDir) { rmSync(memDir, { recursive: true, force: true }); memDir = undefined; }
  if (origMcpUrl !== undefined) process.env.MCP_URL = origMcpUrl;
  else delete process.env.MCP_URL;
});

class ScriptedDecider implements Decider {
  private turn = 0;
  constructor(private readonly tag: string, private readonly usage: TokenUsage) {}
  async decide(_input: DecideInput): Promise<DecideResult> {
    const idx = this.turn++;
    const message: ChatMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `${this.tag}-${idx}`,
        type: 'function',
        function: { name: 'memory_update', arguments: JSON.stringify({ content: `tick ${idx}` }) },
      }],
    };
    return { message, usage: this.usage };
  }
}

describe('runCharacters', () => {
  it('runs characters concurrently, accumulates usage + cost per character, fills rate, captures last action', async () => {
    mcp = await startTestMcpServer();
    process.env.MCP_URL = mcp.url;

    memDir = mkdtempSync(join(tmpdir(), 'chars-mem-'));
    process.env.HARNESS_LOGS_DIR; // touch — just to indicate logs land in default location; logger is overridden below

    const characters: Character[] = [
      { prompt: 'princess', harness: 'baseline', model: { type: 'model', model: 'test/mock-a' } },
      { prompt: 'hunter',   harness: 'baseline', model: { type: 'model', model: 'test/mock-b' } },
    ];

    const rows = createCharacterRows(characters);
    expect(rows.map(r => r.name)).toEqual(['princess', 'hunter']);
    expect(rows.every(r => r.usage.costUsd === 0 && r.status.step === 0)).toBe(true);

    const deciders = [
      new ScriptedDecider('princess', { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.0007 }),
      new ScriptedDecider('hunter',   { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26, cost: 0.0013 }),
    ];

    const result = await runCharacters(characters, rows, {
      deciders,
      logger: createNoopLogger(),
      maxSteps: 3,
    });

    expect(result.failures).toEqual([]);

    // Princess: 3 turns × {prompt 10, completion 4, total 14, cost 0.0007}
    expect(rows[0].usage.prompt).toBe(30);
    expect(rows[0].usage.completion).toBe(12);
    expect(rows[0].usage.total).toBe(42);
    expect(rows[0].usage.costUsd).toBeCloseTo(0.0021, 6);
    expect(rows[0].status.step).toBe(3);
    expect(rows[0].status.lastToolName).toBe('memory_update');
    expect(rows[0].done).toBe(true);
    expect(rows[0].rate.rate(60_000)).toBeGreaterThan(0);
    // Only memory_update was dispatched → harness kind, must not count as an MCP action.
    expect(rows[0].usage.mcpCalls).toBe(0);

    // Hunter: 3 turns × {prompt 20, completion 6, total 26, cost 0.0013}
    expect(rows[1].usage.prompt).toBe(60);
    expect(rows[1].usage.completion).toBe(18);
    expect(rows[1].usage.total).toBe(78);
    expect(rows[1].usage.costUsd).toBeCloseTo(0.0039, 6);
    expect(rows[1].status.step).toBe(3);
    expect(rows[1].done).toBe(true);
    expect(rows[1].usage.mcpCalls).toBe(0);
  }, 15_000);

  it('aborts all characters when the abort signal fires', async () => {
    mcp = await startTestMcpServer();
    process.env.MCP_URL = mcp.url;

    const characters: Character[] = [
      { prompt: 'princess', harness: 'baseline', model: { type: 'model', model: 'test/mock-a' } },
      { prompt: 'hunter',   harness: 'baseline', model: { type: 'model', model: 'test/mock-b' } },
    ];
    const rows = createCharacterRows(characters);

    const slow: Decider = {
      async decide(): Promise<DecideResult> {
        await new Promise(r => setTimeout(r, 30));
        return {
          message: { role: 'assistant', content: null, tool_calls: [{
            id: 'c', type: 'function',
            function: { name: 'memory_update', arguments: JSON.stringify({ content: '.' }) },
          }] },
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
    };

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);

    const result = await runCharacters(characters, rows, {
      deciders: [slow, slow],
      logger: createNoopLogger(),
      abortSignal: ac.signal,
    });

    expect(result.failures).toEqual([]);
    expect(rows.every(r => r.done)).toBe(true);
    // Both characters should have completed at least one turn before abort.
    expect(rows[0].status.step).toBeGreaterThanOrEqual(1);
    expect(rows[1].status.step).toBeGreaterThanOrEqual(1);
  }, 15_000);
});
