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

  // Visual sprite state. `walkFrame` and `frameTimer` are generic
  // animation-frame state — used by the creature walk cycle (advance while
  // moving) and by animated statics like the campfire (advance always at
  // the sheet's fps). `frameTimer` is in milliseconds for animated statics
  // and in seconds for the creature walk cycle (the two paths never share
  // an entity).
  spriteSheet: SpriteSheetRef;
  walkFrame: number;
  frameTimer: number;

  // Current visual tile position (fractional). Renderer + camera follow read this.
  visualX: number;
  visualY: number;

  // Screen-space bounding box, populated during draw. Used for Y-sort
  // and AABB click/hover hit testing. Coordinates are in virtual-pixel
  // space (pre-zoom).
  screenX: number;
  screenY: number;
  screenW: number;
  screenH: number;

  // Top-left of the current frame in sheet-pixel space, populated during
  // draw alongside the AABB. Lets alpha-aware hit-test sample
  // spriteSheet.alphaMask without re-deriving the slice math.
  spriteSrcX: number;
  spriteSrcY: number;

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
