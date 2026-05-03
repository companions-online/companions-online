// Discriminated union for "what UI overlay is currently taking over the
// play area." Replaces the prior parallel scene flags (inventoryOpen,
// containerEntityId, containerItems, dialogueNpcId, dialogue). Carries
// per-overlay data inside the variant so closing an overlay drops its
// data atomically — no more stale containerItems lingering after close.
//
// Mutual exclusion is enforced by the type: only one overlay at a time.
//
// Scope is intentionally narrow: this represents *modal* UI that takes
// over input. Non-modal modes (chat-input focus, placement-mode cursor,
// quickbar selection) stay as their own scene/keyboard fields.

import type { SyncedInventoryItem } from '@shared/protocol/codec.js';

export type Overlay =
  | { kind: 'none' }
  | { kind: 'inventory' }
  | { kind: 'container'; entityId: number; items: SyncedInventoryItem[] }
  | { kind: 'dialogue';  npcId: number; dialogue: unknown }
  | { kind: 'menu';      screen: 'landing' | 'create-join' | 'settings' };

/** True when the inventory panel should render — both the standalone
 *  inventory overlay and the container overlay (which renders the inventory
 *  panel with the container pinned to its right column). */
export function isInventoryShowing(o: Overlay): boolean {
  return o.kind === 'inventory' || o.kind === 'container';
}

/** True for any overlay that should swallow world clicks / keys. */
export function isInputCaptured(o: Overlay): boolean {
  return o.kind !== 'none';
}

export function getContainer(o: Overlay):
  | { entityId: number; items: SyncedInventoryItem[] }
  | null {
  return o.kind === 'container' ? o : null;
}
