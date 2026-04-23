import { Terrain, Building, isWalkable, isPlaceable, isLightPassing } from '../terrain.js';
import { CHUNK_SIZE } from '../constants.js';

export class WorldMap {
  readonly terrain: Uint8Array;
  readonly buildings: Uint8Array;
  readonly buildingMeta: Uint8Array;
  readonly dirtyTiles = new Set<number>();

  constructor(readonly width: number, readonly height: number) {
    const size = width * height;
    this.terrain = new Uint8Array(size);
    this.buildings = new Uint8Array(size);
    this.buildingMeta = new Uint8Array(size);
  }

  static fromBuffers(
    width: number, height: number,
    terrain: Uint8Array, buildings: Uint8Array, buildingMeta: Uint8Array,
  ): WorldMap {
    const map = new WorldMap(width, height);
    map.terrain.set(terrain);
    map.buildings.set(buildings);
    map.buildingMeta.set(buildingMeta);
    return map;
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTerrain(x: number, y: number): Terrain {
    return this.terrain[this.idx(x, y)] as Terrain;
  }

  setTerrain(x: number, y: number, t: Terrain): void {
    const i = this.idx(x, y);
    this.terrain[i] = t;
    this.dirtyTiles.add(i);
  }

  getBuilding(x: number, y: number): Building {
    return this.buildings[this.idx(x, y)] as Building;
  }

  setBuilding(x: number, y: number, b: Building): void {
    const i = this.idx(x, y);
    this.buildings[i] = b;
    this.dirtyTiles.add(i);
  }

  clearDirtyTiles(): void {
    this.dirtyTiles.clear();
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return isWalkable(this.getTerrain(x, y), this.getBuilding(x, y));
  }

  isPlaceable(x: number, y: number, newBuilding: Building | null): boolean {
    if (!this.inBounds(x, y)) return false;
    return isPlaceable(this.getTerrain(x, y), this.getBuilding(x, y), newBuilding);
  }

  isLightPassing(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return isLightPassing(this.getTerrain(x, y), this.getBuilding(x, y));
  }

  getChunkTerrain(chunkX: number, chunkY: number): Uint8Array {
    return this.extractChunk(this.terrain, chunkX, chunkY);
  }

  getChunkBuildings(chunkX: number, chunkY: number): Uint8Array {
    return this.extractChunk(this.buildings, chunkX, chunkY);
  }

  getChunkBuildingMeta(chunkX: number, chunkY: number): Uint8Array {
    return this.extractChunk(this.buildingMeta, chunkX, chunkY);
  }

  private extractChunk(layer: Uint8Array, chunkX: number, chunkY: number): Uint8Array {
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const startX = chunkX * CHUNK_SIZE;
    const startY = chunkY * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        out[ly * CHUNK_SIZE + lx] = layer[(startY + ly) * this.width + (startX + lx)];
      }
    }
    return out;
  }
}
