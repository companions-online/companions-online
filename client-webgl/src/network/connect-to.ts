// Explicit-URL WebSocket connect with timeout + categorized errors.
// Used by the menu's "Join World" path; the existing connect() in
// connection.ts is the same-origin auto-connect path used for
// server-served boots that skip the menu (today: none — Phase 2 moved
// the served boot through the menu too).
//
// The Promise resolves once the Welcome opcode arrives. This lets the
// caller distinguish "connected to a real game server" from "connected
// to something that speaks a different protocol" — important for the
// menu's connecting → connect-error UX.
//
// Buffering: the server sends pre-welcome traffic (chunk messages —
// addPlayer calls onChunkNeeded for each interest-range chunk *before*
// onInitialState's encodeWelcome). Those messages, plus any that arrive
// in the window between welcome and the caller installing onMessage,
// are buffered in arrival order and replayed when the handler is wired
// — wireSceneToConnection still sees the same sequence the server sent.
//
// "wrong-protocol" therefore means a message body that fails to decode
// (i.e. real garbage), not "the first message wasn't welcome." A server
// that streams chunks but never sends welcome will time out instead.

import { decodeServerMessage, encodeAction } from '@shared/protocol/codec.js';
import type { DecodedServerMessage } from '@shared/protocol/codec.js';
import type { Connection, ServerMessageHandler } from './connection.js';

export type ConnectError =
  | { kind: 'bad-url';            url: string }
  | { kind: 'refused';            url: string }
  | { kind: 'timeout';            url: string }
  | { kind: 'closed-pre-welcome'; url: string }
  | { kind: 'wrong-protocol';     url: string };

/** User-visible string for a ConnectError. Centralized here so the
 *  connect-error overlay screen and any future surface (toast, log) all
 *  render identical wording. */
export function formatConnectError(e: ConnectError): string {
  switch (e.kind) {
    case 'bad-url':            return `Invalid URL: ${e.url}`;
    case 'refused':            return `Couldn't reach the server`;
    case 'timeout':            return `Connection timed out`;
    case 'closed-pre-welcome': return `Server closed the connection before sending welcome`;
    case 'wrong-protocol':     return `That host doesn't look like a Companions server`;
  }
}

export interface ConnectToOptions {
  /** Reject with `kind: 'timeout'` if the welcome hasn't arrived by then. */
  timeoutMs?: number;
  /** One-way artificial latency for both directions. Mirrors connect()'s
   *  `?latency=N` param but is opt-in here. */
  latencyMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

export function connectTo(url: string, opts: ConnectToOptions = {}): Promise<Connection> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const latencyMs = opts.latencyMs ?? 0;

  // Pre-validate URL syntax so a malformed string fails fast with a
  // dedicated error kind rather than the WebSocket constructor's
  // SyntaxError.
  try { new URL(url); } catch {
    const err: ConnectError = { kind: 'bad-url', url };
    return Promise.reject(err);
  }

  return new Promise<Connection>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      reject({ kind: 'bad-url', url });
      return;
    }
    ws.binaryType = 'arraybuffer';

    let open = false;
    let welcomed = false;
    let userHandler: ServerMessageHandler | null = null;
    /** Messages decoded before the caller installs onMessage — drained
     *  in arrival order on the first onMessage call. Covers two windows:
     *  (1) pre-welcome chunks sent by addPlayer's onChunkNeeded loop, and
     *  (2) post-welcome messages between resolve() and the caller's
     *  connRef.swap(conn) → conn.onMessage(h) wiring. */
    const buffered: DecodedServerMessage[] = [];
    const pendingSends: ArrayBuffer[] = [];

    const timer = setTimeout(() => {
      if (welcomed) return;
      try { ws.close(); } catch { /* */ }
      reject({ kind: 'timeout', url });
    }, timeoutMs);

    function deliver(msg: DecodedServerMessage): void {
      if (!userHandler) return;
      const h = userHandler;
      if (latencyMs > 0) setTimeout(() => h(msg), latencyMs);
      else h(msg);
    }

    ws.addEventListener('open', () => {
      open = true;
      while (pendingSends.length > 0) {
        const buf = pendingSends.shift()!;
        if (ws.readyState === WebSocket.OPEN) ws.send(buf);
      }
    });

    ws.addEventListener('message', (ev) => {
      const data = ev.data;
      if (!(data instanceof ArrayBuffer)) return;
      let msg: DecodedServerMessage;
      try {
        msg = decodeServerMessage(data);
      } catch {
        if (!welcomed) {
          clearTimeout(timer);
          try { ws.close(); } catch { /* */ }
          reject({ kind: 'wrong-protocol', url });
        }
        return;
      }
      if (!welcomed) {
        buffered.push(msg);
        if (msg.type === 'welcome') {
          welcomed = true;
          clearTimeout(timer);
          resolve(makeConnection());
        }
        return;
      }
      // Welcomed; buffer until the caller wires up onMessage so no
      // post-welcome traffic (env sync, entity full state, inventory)
      // is dropped during the resolve→swap microtask gap.
      if (userHandler) deliver(msg);
      else buffered.push(msg);
    });

    ws.addEventListener('error', () => {
      // 'error' fires for refused / DNS / TLS / network at any time.
      // Pre-welcome it's a connection failure; post-welcome the connection
      // is already handed off to the caller, who will see it via 'close'
      // (as a normal disconnect — surfacing those is out of scope here).
      if (welcomed) return;
      clearTimeout(timer);
      reject({ kind: 'refused', url });
    });

    ws.addEventListener('close', () => {
      open = false;
      if (welcomed) return;
      clearTimeout(timer);
      reject({ kind: 'closed-pre-welcome', url });
    });

    function makeConnection(): Connection {
      return {
        get isOpen() { return open; },
        onMessage(h) {
          userHandler = h;
          // Drain pre-welcome chunks + welcome + any post-welcome
          // messages that arrived before the handler was wired. Order
          // preserved so wireSceneToConnection sees the same sequence
          // the server sent (which the same-origin connect path also
          // delivers in arrival order).
          if (buffered.length === 0) return;
          const drain = buffered.splice(0);
          if (latencyMs > 0) {
            for (const m of drain) setTimeout(() => h(m), latencyMs);
          } else {
            for (const m of drain) h(m);
          }
        },
        send(action) {
          const buf = encodeAction(action);
          const dispatch = () => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
            else pendingSends.push(buf);
          };
          if (latencyMs > 0) setTimeout(dispatch, latencyMs);
          else dispatch();
        },
        close() {
          try { ws.close(); } catch { /* */ }
        },
      };
    }
  });
}
