import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, readFileSync as rf } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runCompact } from '../compact.js';
import { startTestMcpServer, type TestMcpServerHandle } from './helpers/mcp-server.js';
import { startMockOpenRouter, type MockOpenRouterHandle } from './helpers/openrouter-mock.js';
import { createNoopLogger } from './helpers/noop-logger.js';
import { openMemoryFile } from '../memory-file.js';
import type { ChatResponse } from '../openrouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const configDir = join(fixturesDir, 'config');

function loadFixture(name: string): ChatResponse {
  return JSON.parse(readFileSync(join(fixturesDir, 'openrouter', `${name}.json`), 'utf8'));
}

let mcp: TestMcpServerHandle | undefined;
let mock: MockOpenRouterHandle | undefined;
let memDir: string | undefined;

afterEach(async () => {
  await mcp?.close(); mcp = undefined;
  await mock?.close(); mock = undefined;
  if (memDir) { rmSync(memDir, { recursive: true, force: true }); memDir = undefined; }
  delete process.env.MCP_URL;
  delete process.env.OPENROUTER_BASE_URL;
});

describe('harness end-to-end against mocks', () => {
  it('rebuilds prompt each turn, echoes reasoning, routes memory tool + perceptions correctly', async () => {
    mcp = await startTestMcpServer();
    mock = await startMockOpenRouter([
      loadFixture('turn1'),
      loadFixture('turn2'),
      loadFixture('turn3'),
    ]);

    process.env.MCP_URL = mcp.url;
    process.env.OPENROUTER_BASE_URL = mock.baseUrl;
    process.env.OPENROUTER_API_KEY = 'test-key';

    memDir = mkdtempSync(join(tmpdir(), 'harness-mem-'));
    const memory = openMemoryFile('session-test', memDir);
    const logger = createNoopLogger();

    await runCompact({
      configName: 'test-model',
      configDir,
      maxSteps: 3,
      logger,
      memory,
      sessionId: 'session-test',
    });

    expect(mock.requests.length).toBe(3);

    // --- Turn 1 ---
    const req1 = mock.requests[0].body;
    expect(req1.model).toBe('test/mock');
    const tools1 = req1.tools as Array<{ function: { name: string } }>;
    const names1 = tools1.map(t => t.function.name).sort();
    expect(names1).toContain('memory_update');
    expect(names1).toContain('add');
    expect(names1).toContain('echo');
    expect(names1).toContain('now');

    const msgs1 = req1.messages as Array<{ role: string; content?: string }>;
    expect(msgs1.map(m => m.role)).toEqual(['system', 'user']);
    expect(msgs1[0].content).toContain('(empty)'); // memory
    expect(msgs1[0].content).toContain('(none yet)'); // action window

    // --- Turn 2 ---
    const req2 = mock.requests[1].body;
    const msgs2 = req2.messages as Array<{
      role: string; content?: string | null;
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      tool_call_id?: string; reasoning_details?: unknown;
    }>;
    expect(msgs2.map(m => m.role)).toEqual(['system', 'assistant', 'tool']);
    // No "Last action" section — the full call+response lives in the
    // assistant+tool message pair.
    expect(msgs2[0].content).not.toContain('Last action');
    expect(msgs2[0].content).toContain('[1]');
    expect(msgs2[0].content).toContain('add({"a":2,"b":3})'); // in action window
    expect(msgs2[0].content).toContain('"I\'ll add 2 and 3."');

    expect(msgs2[1].tool_calls?.[0].function.name).toBe('add');
    expect(msgs2[1].reasoning_details).toEqual([{ type: 'thought', text: 'call add(2,3)' }]);
    expect(msgs2[2].tool_call_id).toBe('call_1');
    expect(msgs2[2].content).toBe('5');

    // --- Turn 3 ---
    const req3 = mock.requests[2].body;
    const msgs3 = req3.messages as Array<{ role: string; content?: string | null }>;
    expect(msgs3.map(m => m.role)).toEqual(['system', 'assistant', 'tool']);
    expect(msgs3[0].content).toContain('progress: 5'); // memory was updated in turn 2
    expect(msgs3[0].content).not.toContain('Last action');
    // Harness turn appears in the action window.
    expect(msgs3[0].content).toContain('memory_update');

    // Memory file was written.
    expect(memory.read()).toBe('progress: 5');

    // Turn 3's tool call (echo with <map>) was dispatched — verify via MCP result
    // reflected nowhere else except: the run processed it (3 responses consumed).
  });
});
