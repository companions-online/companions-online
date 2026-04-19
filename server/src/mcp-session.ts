import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameWorld } from './game-world.js';

export interface McpSession {
  transport: Transport;
  conn: McpConnection;
  /** 0 until identify() spawns a player entity. */
  entityId: number;
  server: McpServer | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
}

/** Interval between MCP keepalive pings. Overridable for tests. */
let keepaliveIntervalMs = 15_000;

/** Test-only: override the keepalive interval. */
export function _setKeepaliveIntervalMs(ms: number): void {
  keepaliveIntervalMs = ms;
}

const sessions = new Map<string, McpSession>();

export function getSession(sessionId: string): McpSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionCount(): number {
  return sessions.size;
}

export function createSession(
  sessionId: string,
  transport: Transport,
  conn: McpConnection,
  entityId: number,
  server: McpServer | null = null,
): McpSession {
  const session: McpSession = {
    transport, conn, entityId, server,
    keepaliveTimer: null,
  };
  sessions.set(sessionId, session);

  // Per-session MCP-native keepalive. Issues a `ping` JSON-RPC request on the
  // standalone SSE stream every keepaliveIntervalMs. Real bytes on the stream
  // defeat Node's request timeout + any proxy / harness liveness checks.
  // See docs/plans/mcp-server-keepalive.md.
  if (server) {
    const timer = setInterval(() => {
      // Rejection happens naturally when transport is mid-close;
      // destroySession will fire via transport.onclose.
      server.server.ping().catch(() => { /* noop */ });
    }, keepaliveIntervalMs);
    timer.unref();
    session.keepaliveTimer = timer;
  }

  return session;
}

/** Upgrade a previously-unidentified session with its entity id. */
export function setSessionEntity(sessionId: string, entityId: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.entityId = entityId;
  return true;
}

export function destroySession(sessionId: string, world: GameWorld): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.keepaliveTimer) {
    clearInterval(session.keepaliveTimer);
    session.keepaliveTimer = null;
  }

  if (session.conn.pendingAction) {
    session.conn.pendingAction.resolve({ status: 'complete' });
    session.conn.pendingAction = null;
  }

  if (session.entityId !== 0) {
    world.removePlayer(session.entityId);
  }
  sessions.delete(sessionId);
  return true;
}
