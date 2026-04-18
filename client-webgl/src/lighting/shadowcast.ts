// Per-target raycast lighting. For each tile within the light's radius, walk a
// Bresenham line back to the origin; if any intermediate tile blocks, the
// target is dark. Strictly correct wall blocking (no around-corner bleed).
//
// Cost: O(radius²) targets × O(radius) ray steps = O(radius³) per light.
// At radius 6 = ~216 × 6 = 1300 steps. Negligible against the few lights we
// expect to have visible at once.

export interface ShadowcastArgs {
  originX: number;
  originY: number;
  radius: number;
  /** Whether a tile blocks light. Origin is always considered unblocked. */
  blocks: (x: number, y: number) => boolean;
  /** Called once per lit tile (including origin). distSq is integer squared
   *  Chebyshev-ignoring Euclidean distance — callers convert to falloff. */
  visit: (x: number, y: number, distSq: number) => void;
}

/** Walk a Bresenham line from (x0,y0) toward (x1,y1). Returns true if every
 *  intermediate tile (excluding both endpoints) is unblocked. */
function lineIsClear(
  x0: number, y0: number,
  x1: number, y1: number,
  blocks: (x: number, y: number) => boolean,
): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  // Step to the first intermediate cell, then iterate until we reach (x1,y1).
  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) return true;
    if (blocks(x, y)) return false;
  }
}

export function shadowcast({ originX, originY, radius, blocks, visit }: ShadowcastArgs): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distSq = dx * dx + dy * dy;
      if (distSq > r2) continue;
      const x = originX + dx;
      const y = originY + dy;
      if (distSq === 0) {
        visit(x, y, 0);
        continue;
      }
      // The target tile itself is allowed to be a blocker — a wall that is
      // directly lit (from the light's perspective) should still render lit,
      // even though it blocks light *through* it. So we check the line
      // excluding endpoints.
      if (lineIsClear(originX, originY, x, y, blocks)) {
        visit(x, y, distSq);
      }
    }
  }
}
