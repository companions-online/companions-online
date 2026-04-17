// ClientEntity is the client-side per-entity record. It extends the
// server-defined EntityComponents (so server-pushed components ride on the same
// struct without re-shaping) and adds visual state the renderer needs.
//
// Both local-only entities (the wandering deer for now) and future
// network-driven entities use this same shape. They differ only in how
// `visualX/visualY` get updated each frame:
//   - Local: the entity's own tick closure writes them.
//   - Network (future): a lerp helper writes them from `lerpFrom*` + `position`
//     + `nextWaypoint` + `speed`.

import type { EntityComponents } from '@shared/protocol/codec.js';
import type { SpriteRenderer } from './sprite-renderer.js';
import type { SpriteSheetRef } from './sprite-registry.js';
import type { Scene } from '../scene.js';

export interface ClientEntity extends EntityComponents {
  id: number;

  // Visual sprite state
  spriteSheet: SpriteSheetRef;
  walkFrame: number;
  frameTimer: number;

  // Current visual tile position (fractional). Renderer + camera follow read this.
  visualX: number;
  visualY: number;

  // Y-sort cache, populated during render pass
  screenY: number;

  // Per-frame logic. Each entity type provides its own.
  tick?: (e: ClientEntity, dt: number, scene: Scene) => void;
  // Per-frame draw. Each entity type owns its sprite math (frame columns/rows, foot anchor).
  // `scene` is threaded through so the draw path can sample ground elevation
  // under the entity (see scene.getGroundZ).
  draw?: (
    e: ClientEntity,
    sprites: SpriteRenderer,
    gl: WebGL2RenderingContext,
    offsetX: number,
    offsetY: number,
    scene: Scene,
  ) => void;

  // ===== Future network use — declared but unused this round =====
  // Set when a server checkpoint arrives. The lerp helper will read these
  // alongside `position`, `nextWaypoint`, and `speed` (all from EntityComponents).
  lerpFromX?: number;
  lerpFromY?: number;
  checkpointMs?: number;
}
