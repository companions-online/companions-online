import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameWorld } from './game-world.js';

export interface McpSession {
  transport: Transport;
  conn: McpConnection;
  entityId: number;
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
): McpSession {
  const session: McpSession = { transport, conn, entityId };
  sessions.set(sessionId, session);
  return session;
}

export function destroySession(sessionId: string, world: GameWorld): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.conn.pendingAction) {
    session.conn.pendingAction.resolve({ status: 'complete' });
    session.conn.pendingAction = null;
  }

  world.removePlayer(session.entityId);
  sessions.delete(sessionId);
  return true;
}
