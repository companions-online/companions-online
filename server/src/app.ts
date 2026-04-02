import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { decodeClientMessage, encodePong } from '@shared/protocol/codec.js';
import type { GameWorld } from './game-world.js';
import { McpConnection } from './connections/mcp-connection.js';
import { WebSocketConnection } from './connections/ws-connection.js';
import { Telemetry } from './telemetry.js';
import { registerTools } from './mcp-tools.js';
import { getSession, createSession, destroySession } from './mcp-session.js';

export function createApp(world: GameWorld, telemetry: Telemetry) {
  const app = new Hono();
  let wsConnectionCount = 0;

  // --- MCP Streamable HTTP ---

  app.all('/mcp', async (c) => {
    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const session = getSession(sessionId);
      if (!session) {
        return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unknown session' }, id: null }, { status: 404 });
      }
      return (session.transport as WebStandardStreamableHTTPServerTransport).handleRequest(c.req.raw);
    }

    // New session — create transport, server, and connection
    const conn = new McpConnection(8);
    const mcpServer = new McpServer({ name: 'companions-online', version: '0.1.0' });
    registerTools(mcpServer, conn, world);

    let storedSessionId: string | undefined;

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        storedSessionId = crypto.randomUUID();
        return storedSessionId;
      },
      onsessioninitialized: (sid: string) => {
        const entityId = world.addPlayer(conn);
        createSession(sid, transport, conn, entityId);
      },
    });

    transport.onclose = () => {
      if (storedSessionId) destroySession(storedSessionId, world);
    };

    await mcpServer.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // --- WebSocket for game clients ---

  const wsUpgrade = (rawWs: import('ws').WebSocket) => {
    wsConnectionCount++;
    const conn = new WebSocketConnection(rawWs, telemetry);
    const entityId = world.addPlayer(conn);

    rawWs.on('message', (data: Buffer | ArrayBuffer) => {
      try {
        const raw = data instanceof ArrayBuffer
          ? data
          : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength) as ArrayBuffer;
        telemetry.recordBytesReceived('ws', raw.byteLength);
        const msg = decodeClientMessage(raw);
        if (msg.type === 'action') {
          world.setAction(entityId, msg.data);
        } else if (msg.type === 'ping') {
          rawWs.send(encodePong(msg.clientTime));
        }
      } catch (_e) { /* bad message */ }
    });

    rawWs.on('close', () => {
      wsConnectionCount--;
      world.removePlayer(entityId);
    });
  };

  return { app, wsUpgrade, getWsConnectionCount: () => wsConnectionCount };
}
