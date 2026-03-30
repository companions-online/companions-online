export class OccupancyGrid {
  private grid: Uint16Array;

  constructor(private width: number, private height: number) {
    this.grid = new Uint16Array(width * height);
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  set(x: number, y: number, entityId: number): void {
    this.grid[this.idx(x, y)] = entityId;
  }

  clear(x: number, y: number): void {
    this.grid[this.idx(x, y)] = 0;
  }

  get(x: number, y: number): number {
    return this.grid[this.idx(x, y)];
  }

  isOccupied(x: number, y: number): boolean {
    return this.grid[this.idx(x, y)] !== 0;
  }

  move(fromX: number, fromY: number, toX: number, toY: number, entityId: number): void {
    this.grid[this.idx(fromX, fromY)] = 0;
    this.grid[this.idx(toX, toY)] = entityId;
  }
}
