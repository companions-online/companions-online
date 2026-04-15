// In-memory Connection for client-gl tests. Drives inbound by invoking the
// registered handler with decoded messages; captures outbound encoded
// actions. No sockets, no codec round-trip by default — tests pass
// DecodedServerMessage objects directly to deliver() for speed and clarity.

import type { Connection, ServerMessageHandler } from '@client-webgl/network/connection.js';
import type { DecodedAction, DecodedServerMessage } from '@shared/protocol/codec.js';

export interface FakeConnection extends Connection {
  /** Deliver a decoded message to the handler registered via onMessage. */
  deliver(msg: DecodedServerMessage): void;
  /** Captured actions sent via send(). Newest last. */
  readonly sent: DecodedAction[];
  /** Clear the captured-actions list. */
  clearSent(): void;
}

export function createFakeConnection(): FakeConnection {
  let handler: ServerMessageHandler | null = null;
  const sent: DecodedAction[] = [];

  return {
    isOpen: true,
    onMessage(h) { handler = h; },
    send(action) { sent.push(action); },
    close() {},
    deliver(msg) { if (handler) handler(msg); },
    get sent() { return sent; },
    clearSent() { sent.length = 0; },
  };
}
