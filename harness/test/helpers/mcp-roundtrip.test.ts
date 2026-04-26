import { describe, it, expect, afterEach } from 'vitest';
import { ReconnectingMcpClient } from '../../helpers/mcp-client.js';
import { createDispatcher, mcpToOpenAI } from '../../helpers/dispatcher.js';
import { startTestMcpServer, type TestMcpServerHandle } from './mcp-server.js';
import { createNoopLogger } from './noop-logger.js';

let handle: TestMcpServerHandle | undefined;
afterEach(async () => { await handle?.close(); handle = undefined; });

describe('MCP client round-trip', () => {
  it('lists tools and calls each', async () => {
    handle = await startTestMcpServer();
    const log = createNoopLogger();
    const client = new ReconnectingMcpClient(handle.url, log);
    await client.connect();

    const tools = client.getTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['add', 'echo', 'now']);

    const echo = await client.callTool('echo', { message: 'hi' });
    expect(echo.content).toEqual([{ type: 'text', text: 'hi' }]);

    const add = await client.callTool('add', { a: 2, b: 40 });
    expect(add.content).toEqual([{ type: 'text', text: '42' }]);

    const now = await client.callTool('now', {});
    expect(now.content).toEqual([{ type: 'text', text: '2026-04-21T00:00:00Z' }]);

    await client.close();
  });

  it('translates MCP tool schemas to OpenAI tool format', async () => {
    handle = await startTestMcpServer();
    const log = createNoopLogger();
    const client = new ReconnectingMcpClient(handle.url, log);
    await client.connect();

    const echo = client.getTools().find(t => t.name === 'echo')!;
    const openai = mcpToOpenAI(echo);
    expect(openai.type).toBe('function');
    expect(openai.function.name).toBe('echo');
    expect(openai.function.parameters).toMatchObject({ type: 'object' });

    await client.close();
  });

  it('dispatcher routes to MCP and to harness tools', async () => {
    handle = await startTestMcpServer();
    const log = createNoopLogger();
    const client = new ReconnectingMcpClient(handle.url, log);
    await client.connect();

    const dispatcher = createDispatcher(client, [{
      name: 'harness_ping',
      description: 'harness-local',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ text: 'pong' }),
    }]);

    const openaiTools = dispatcher.buildOpenAITools();
    expect(openaiTools.map(t => t.function.name).sort()).toEqual(['add', 'echo', 'harness_ping', 'now']);

    const mcpResult = await dispatcher.dispatch({
      id: 'x', type: 'function',
      function: { name: 'add', arguments: JSON.stringify({ a: 1, b: 2 }) },
    });
    expect(mcpResult.text).toBe('3');

    const harnessResult = await dispatcher.dispatch({
      id: 'y', type: 'function',
      function: { name: 'harness_ping', arguments: '{}' },
    });
    expect(harnessResult.text).toBe('pong');

    await client.close();
  });
});
