export interface Entity {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void;
  screenY(): number;
  interpTileX(): number;
  interpTileY(): number;
}

/** Entity that accepts click-to-move commands. */
export interface ControllableEntity extends Entity {
  moveTo(tileX: number, tileY: number): void;
}
