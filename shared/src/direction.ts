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
