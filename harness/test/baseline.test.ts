import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runBaseline } from '../baseline.js';
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

describe('baseline harness', () => {
  it('accumulates full history and pings "continue" after each tool result', async () => {
    mcp = await startTestMcpServer();
    mock = await startMockOpenRouter([
      loadFixture('turn1'), loadFixture('turn2'), loadFixture('turn3'),
    ]);

    process.env.MCP_URL = mcp.url;
    process.env.OPENROUTER_BASE_URL = mock.baseUrl;
    process.env.OPENROUTER_API_KEY = 'test-key';

    memDir = mkdtempSync(join(tmpdir(), 'baseline-mem-'));
    const memory = openMemoryFile('session-baseline', memDir);

    await runBaseline({
      configName: 'test-model', configDir,
      maxSteps: 3,
      logger: createNoopLogger(),
      memory,
      sessionId: 'session-baseline',
    });

    expect(mock.requests.length).toBe(3);

    // Turn 1: just system + user(first).
    const msgs1 = mock.requests[0].body.messages as Array<{ role: string; content?: string | null }>;
    expect(msgs1.map(m => m.role)).toEqual(['system', 'user']);

    // Turn 2: system + user + assistant + tool + user(continue).
    const msgs2 = mock.requests[1].body.messages as Array<{ role: string; content?: string | null }>;
    expect(msgs2.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(msgs2[4].content).toBe('continue');

    // Turn 3: each prior turn appended verbatim — 8 messages total.
    const msgs3 = mock.requests[2].body.messages as Array<{ role: string; content?: string | null }>;
    expect(msgs3.map(m => m.role)).toEqual([
      'system', 'user',
      'assistant', 'tool', 'user',
      'assistant', 'tool', 'user',
    ]);
    expect(msgs3[4].content).toBe('continue');
    expect(msgs3[7].content).toBe('continue');
    // System message was rebuilt with current memory between turn 2 and 3
    // (memory was set to "progress: 5" by turn 2's memory_update tool).
    expect(msgs3[0].content).toContain('progress: 5');
  });
});
