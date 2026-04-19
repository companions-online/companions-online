/**
 *     7  0  1
 *      \ | /
 *   6 -- · -- 2
 *      / | \
 *     5  4  3
 */
export const enum Direction {
  N  = 0,
  NE = 1,
  E  = 2,
  SE = 3,
  S  = 4,
  SW = 5,
  W  = 6,
  NW = 7,
}

export const DX: readonly number[] = [ 0,  1,  1,  1,  0, -1, -1, -1];
export const DY: readonly number[] = [-1, -1,  0,  1,  1,  1,  0, -1];

export function isDiagonal(dir: Direction): boolean {
  return (dir & 1) === 1;
}

/** 8-way direction from one tile to another, or undefined when the tiles
 *  are the same. Uses Math.sign so works for any tile delta (not just
 *  unit vectors) — diagonal when |dx| and |dy| are both nonzero, cardinal
 *  otherwise. */
export function dirFromTo(fromX: number, fromY: number, toX: number, toY: number): Direction | undefined {
  const sx = Math.sign(toX - fromX);
  const sy = Math.sign(toY - fromY);
  if (sx === 0 && sy === 0) return undefined;
  for (let d = 0; d < 8; d++) {
    if (DX[d] === sx && DY[d] === sy) return d as Direction;
  }
  return undefined;
}
