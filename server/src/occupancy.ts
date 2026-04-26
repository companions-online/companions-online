// OccupancyGrid: the single blocker entity on each tile.
// Tracked: players, critters, NPCs, placed interactive entities (doors,
// chests, campfires), trees. NOT tracked: ground items, corpses,
// building-layer walls (walls live in WorldMap.building; ground items +
// corpses are walk-through).

/** Reported when an ownership invariant is violated. Injected by the owning
 *  world so this module doesn't depend on the logger directly. */
export type OccupancyViolationReporter = (msg: string, data: unknown) => void;

export class OccupancyGrid {
  private grid: Uint16Array;
  private readonly onViolation: OccupancyViolationReporter;

  constructor(
    private width: number,
    private height: number,
    onViolation?: OccupancyViolationReporter,
  ) {
    this.grid = new Uint16Array(width * height);
    this.onViolation = onViolation ?? (() => {});
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Mark `entityId` as the blocker on (x,y). Asserts the tile is either
   *  empty or already owned by this entity — callers must release the
   *  previous owner first. */
  set(x: number, y: number, entityId: number): void {
    const i = this.idx(x, y);
    const prev = this.grid[i];
    if (prev !== 0 && prev !== entityId) {
      this.onViolation('occupancy.set: tile already owned by different entity', {
        tile: { x, y }, newOwner: entityId, existingOwner: prev,
      });
      return;
    }
    this.grid[i] = entityId;
  }

  /** Release (x,y) from `entityId`. No-op + violation report if another
   *  entity currently owns the tile. */
  clear(x: number, y: number, entityId: number): void {
    const i = this.idx(x, y);
    const prev = this.grid[i];
    if (prev === 0) return;
    if (prev !== entityId) {
      this.onViolation('occupancy.clear: wrong owner', {
        tile: { x, y }, requestedOwner: entityId, actualOwner: prev,
      });
      return;
    }
    this.grid[i] = 0;
  }

  get(x: number, y: number): number {
    return this.grid[this.idx(x, y)];
  }

  isOccupied(x: number, y: number): boolean {
    return this.grid[this.idx(x, y)] !== 0;
  }

  /** Move `entityId` from (fromX,fromY) to (toX,toY). Clears `from` only if
   *  this entity actually owns it; sets `to` only if it's empty or
   *  self-owned. Violations are reported but don't throw. */
  move(fromX: number, fromY: number, toX: number, toY: number, entityId: number): void {
    const fromIdx = this.idx(fromX, fromY);
    const fromPrev = this.grid[fromIdx];
    if (fromPrev !== entityId) {
      this.onViolation('occupancy.move: source tile not owned by entity', {
        from: { x: fromX, y: fromY }, to: { x: toX, y: toY },
        entityId, actualOwner: fromPrev,
      });
      // Still set the destination if we can — the entity is moving regardless
      // and leaving `to` stale would cascade worse errors. But don't clobber a
      // third entity's slot.
    } else {
      this.grid[fromIdx] = 0;
    }

    const toIdx = this.idx(toX, toY);
    const toPrev = this.grid[toIdx];
    if (toPrev !== 0 && toPrev !== entityId) {
      this.onViolation('occupancy.move: destination tile already owned', {
        from: { x: fromX, y: fromY }, to: { x: toX, y: toY },
        entityId, existingOwner: toPrev,
      });
      return;
    }
    this.grid[toIdx] = entityId;
  }
}
