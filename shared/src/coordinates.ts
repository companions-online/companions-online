export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

export interface TilePoint {
  tileX: number;
  tileY: number;
}

export function tileToScreen(tileX: number, tileY: number, tileW: number, tileH: number): ScreenPoint {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  return {
    screenX: (tileX - tileY) * halfW,
    screenY: (tileX + tileY) * halfH,
  };
}

export function screenToTile(screenX: number, screenY: number, tileW: number, tileH: number): TilePoint {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  return {
    tileX: Math.floor(screenX / halfW + screenY / halfH) / 2,
    tileY: Math.floor(screenY / halfH - screenX / halfW) / 2,
  };
}
