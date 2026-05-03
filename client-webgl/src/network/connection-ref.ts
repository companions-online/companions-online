// Mutable proxy around Connection so listeners attached at boot survive
// when the underlying connection is replaced.
//
// Why: main.ts boots an observer-mode StandaloneObserverConnection so the
// menu has a live world for its backdrop. When the user clicks Start
// World (Phase 4) or Join World (Phase 5) we tear down that observer
// connection and stand up a player connection (in-tab StandaloneConnection
// or networked WS) on the same scene. Mouse + keyboard controls and
// wireSceneToConnection were attached before either click happened —
// they must keep working against the new connection without being
// re-attached (which would require detaching the old listeners and risk
// leaking duplicate handlers).
//
// Behavior:
//   * Implements Connection itself, so call sites take a ConnectionRef
//     wherever a Connection was expected — zero churn at the 30+ send()
//     call sites in mouse / keyboard / inventory / quickslot / placement
//     / cooking-highlight.
//   * onMessage stores the latest handler and re-installs it on the
//     underlying target on every swap. wireSceneToConnection's single
//     handler subscription thus survives the swap intact.
//   * swap() closes the previous target, stashes the new one, and
//     re-subscribes the handler.

import type { Connection, ServerMessageHandler } from './connection.js';
import type { DecodedAction } from '@shared/protocol/codec.js';

export class ConnectionRef implements Connection {
  private target: Connection;
  private handler: ServerMessageHandler | null = null;

  constructor(initial: Connection) {
    this.target = initial;
    this.installHandler(initial);
  }

  /** Replace the underlying connection. Closes the previous one. */
  swap(next: Connection): void {
    if (this.target === next) return;
    this.target.close();
    this.target = next;
    this.installHandler(next);
  }

  /** Currently-wired underlying connection. Mostly useful for tests. */
  current(): Connection {
    return this.target;
  }

  // --- Connection delegation ---

  get isOpen(): boolean { return this.target.isOpen; }

  send(action: DecodedAction): void {
    this.target.send(action);
  }

  close(): void {
    this.target.close();
  }

  onMessage(handler: ServerMessageHandler): void {
    this.handler = handler;
    this.installHandler(this.target);
  }

  // --- Internal ---

  private installHandler(target: Connection): void {
    target.onMessage((msg) => this.handler?.(msg));
  }
}
