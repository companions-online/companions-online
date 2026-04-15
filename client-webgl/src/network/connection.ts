// WebSocket connection to the game server. Owns the socket, decodes inbound
// messages, and exposes an outbound send(action) that encodes via the shared
// codec. Message dispatch is a plain handler record — the scene registers the
// callbacks it cares about after construction.
//
// Same-origin: the client is served by the game server (see server/src/app.ts
// static middleware), so the WS host is always window.location.host.
//
// Latency emulator: if the page URL carries ?latency=N (milliseconds), each
// inbound dispatch and each outbound send is delayed by N ms via setTimeout.
// Symmetric, so perceived round-trip is 2N. N is clamped to [0, 2000]; pass
// ?latency=0 (or omit the param) to disable.

import { decodeServerMessage, encodeAction } from '@shared/protocol/codec.js';
import type { DecodedAction, DecodedServerMessage } from '@shared/protocol/codec.js';

export type ServerMessageHandler = (msg: DecodedServerMessage) => void;

export interface Connection {
  /** Register the single dispatch handler. Replaces any previous handler. */
  onMessage(handler: ServerMessageHandler): void;
  /** Encode + enqueue an action for send. No-op if socket isn't open. */
  send(action: DecodedAction): void;
  /** Close the underlying socket. Further sends are dropped. */
  close(): void;
  /** True once the socket has opened and the welcome handshake can arrive. */
  readonly isOpen: boolean;
}

export interface ConnectOptions {
  /** One-way latency in ms applied to both directions. Default: read from
   *  ?latency=N URL param (clamped [0, 2000]) or 0. */
  latencyMs?: number;
}

function readLatencyFromUrl(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('latency');
  if (raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 2000);
}

export function connect(options: ConnectOptions = {}): Connection {
  const latencyMs = options.latencyMs ?? readLatencyFromUrl();
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

  const ws = new WebSocket(`${scheme}://${window.location.host}/ws`);
  ws.binaryType = 'arraybuffer';

  let open = false;
  let handler: ServerMessageHandler | null = null;

  // When the socket hasn't opened yet, queue outbound sends so the caller
  // doesn't have to await connection. Flushed on open.
  const pendingSends: ArrayBuffer[] = [];

  function deliverInbound(msg: DecodedServerMessage): void {
    if (handler) handler(msg);
  }

  function rawSend(buf: ArrayBuffer): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(buf);
  }

  ws.addEventListener('open', () => {
    open = true;
    for (const buf of pendingSends) rawSend(buf);
    pendingSends.length = 0;
  });

  ws.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!(data instanceof ArrayBuffer)) return;
    const msg = decodeServerMessage(data);
    if (latencyMs > 0) {
      setTimeout(() => deliverInbound(msg), latencyMs);
    } else {
      deliverInbound(msg);
    }
  });

  ws.addEventListener('close', () => { open = false; });
  ws.addEventListener('error', (ev) => {
    console.error('[network] socket error', ev);
  });

  return {
    get isOpen() { return open; },
    onMessage(h) { handler = h; },
    send(action) {
      const buf = encodeAction(action);
      const dispatch = () => {
        if (ws.readyState === WebSocket.OPEN) rawSend(buf);
        else pendingSends.push(buf);
      };
      if (latencyMs > 0) setTimeout(dispatch, latencyMs);
      else dispatch();
    },
    close() { ws.close(); },
  };
}
