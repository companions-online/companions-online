export interface Entity {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void;
  screenY(): number;
  interpTileX(): number;
  interpTileY(): number;
}
