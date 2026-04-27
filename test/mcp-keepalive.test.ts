import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createSession, destroySession, _setKeepaliveIntervalMs,
} from '../server/src/mcp/session.js';
import { McpConnection } from '../server/src/connections/mcp-connection.js';
import { createTestWorld } from './e2e/helpers.js';

function makeFakeTransport(): Transport {
  return { start: async () => {}, send: async () => {}, close: async () => {} } as Transport;
}

function makeFakeMcpServer(): { server: McpServer; ping: ReturnType<typeof vi.fn> } {
  const ping = vi.fn().mockResolvedValue({});
  const server = {
    server: { ping },
  } as unknown as McpServer;
  return { server, ping };
}

describe('MCP keepalive', () => {
  beforeEach(() => {
    // Aggressive interval so the test completes quickly.
    _setKeepaliveIntervalMs(20);
  });

  afterEach(() => {
    _setKeepaliveIntervalMs(15_000);
  });

  it('issues periodic ping calls while session is live', async () => {
    const world = createTestWorld();
    const { server: mcpServer, ping } = makeFakeMcpServer();
    const conn = new McpConnection();
    createSession('s-live', makeFakeTransport(), conn, 0, mcpServer);

    await new Promise(r => setTimeout(r, 100));
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3);

    destroySession('s-live', world);
  });

  it('stops pinging after destroySession', async () => {
    const world = createTestWorld();
    const { server: mcpServer, ping } = makeFakeMcpServer();
    const conn = new McpConnection();
    createSession('s-stop', makeFakeTransport(), conn, 0, mcpServer);

    await new Promise(r => setTimeout(r, 80));
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(2);

    destroySession('s-stop', world);
    const snapshot = ping.mock.calls.length;

    await new Promise(r => setTimeout(r, 80));
    expect(ping.mock.calls.length).toBe(snapshot);
  });

  it('swallows ping rejection without affecting the interval', async () => {
    const world = createTestWorld();
    const ping = vi.fn().mockRejectedValue(new Error('transport closed'));
    const mcpServer = { server: { ping } } as unknown as McpServer;
    const conn = new McpConnection();
    createSession('s-reject', makeFakeTransport(), conn, 0, mcpServer);

    await new Promise(r => setTimeout(r, 100));
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3);

    destroySession('s-reject', world);
  });

  it('does not start a timer when server is null', async () => {
    const world = createTestWorld();
    const conn = new McpConnection();
    const session = createSession('s-nosrv', makeFakeTransport(), conn, 0, null);
    expect(session.keepaliveTimer).toBeNull();
    destroySession('s-nosrv', world);
  });
});
