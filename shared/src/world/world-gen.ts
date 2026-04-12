import { Terrain, Building } from '../terrain.js';
import { BlueprintType } from '../blueprints.js';
import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '../constants.js';
import { PerlinNoise } from './noise.js';
import { WorldMap } from './world-map.js';

export interface EntitySpawn {
  x: number;
  y: number;
  blueprint: BlueprintType;
}

export interface WorldGenResult {
  map: WorldMap;
  entitySpawns: EntitySpawn[];
}

export function generateWorld(seed: number): WorldGenResult {
  const map = new WorldMap(MAP_SIZE, MAP_SIZE);
  const spawns: EntitySpawn[] = [];

  // Auto-scale factor: all noise frequencies and distance-based zones
  // scale relative to the reference map size of 128
  const scale = MAP_SIZE / 128;

  const elevation = new PerlinNoise(seed);
  const river     = new PerlinNoise(seed + 1);
  const forest    = new PerlinNoise(seed + 2);
  const critter   = new PerlinNoise(seed + 3);

  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;
  const maxDist = MAP_SIZE * 0.45;

  // Simple seeded RNG for sparse placement decisions
  let rng = seed >>> 0;
  function rand(): number {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return (rng >>> 0) / 0x100000000;
  }

  // Scaled noise frequencies (inverse of scale — larger map = lower frequency)
  const elevFreq = 0.03 / scale;
  const riverFreq = 0.05 / scale;
  const forestFreq = 0.08 / scale;
  const critterFreq = 0.3 / scale;

  // Scaled distance zones
  const critterClearDist = Math.round(10 * scale) ** 2;
  const skeletonClearDist = Math.round(20 * scale) ** 2;

  // --- Pass 1: Terrain ---
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));

      const raw = (elevation.octave2d(x * elevFreq, y * elevFreq, 4, 0.5) + 1) / 2;
      const e = raw - (1 - mask);

      let t: Terrain;
      if (e < 0.0)        t = Terrain.Water;
      else if (e < 0.05)  t = Terrain.Sand;
      else if (e > 0.65)  t = Terrain.Rock;
      else if (e > 0.5)   t = Terrain.Dirt;
      else                 t = Terrain.Grass;

      map.setTerrain(x, y, t);
    }
  }

  // --- Pass 2: Rivers ---
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = map.getTerrain(x, y);
      if (t !== Terrain.Grass && t !== Terrain.Dirt) continue;
      const rv = river.noise2d(x * riverFreq, y * riverFreq);
      if (Math.abs(rv) < 0.05) {
        map.setTerrain(x, y, Terrain.River);
      }
    }
  }

  // --- Guarantee spawn area is walkable ---
  const spawnRadius = 5;
  for (let dy = -spawnRadius; dy <= spawnRadius; dy++) {
    for (let dx = -spawnRadius; dx <= spawnRadius; dx++) {
      if (dx * dx + dy * dy > spawnRadius * spawnRadius) continue;
      const sx = SPAWN_X + dx;
      const sy = SPAWN_Y + dy;
      if (sx < 0 || sx >= MAP_SIZE || sy < 0 || sy >= MAP_SIZE) continue;
      const t = map.getTerrain(sx, sy);
      if (t === Terrain.Water || t === Terrain.River || t === Terrain.Rock) {
        map.setTerrain(sx, sy, Terrain.Grass);
      }
    }
  }

  // --- Pass 3: Trees ---
  const treeSet = new Set<number>();
  const key = (x: number, y: number) => y * MAP_SIZE + x;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (map.getTerrain(x, y) !== Terrain.Grass) continue;

      const f = forest.octave2d(x * forestFreq, y * forestFreq, 3, 0.5);
      if (f < 0.2) continue;

      if (treeSet.has(key(x - 1, y)) ||
          treeSet.has(key(x + 1, y)) ||
          treeSet.has(key(x, y - 1)) ||
          treeSet.has(key(x, y + 1))) continue;

      const sdx = x - SPAWN_X;
      const sdy = y - SPAWN_Y;
      if (sdx * sdx + sdy * sdy < 25) continue; // spawn clear zone (fixed 5 tiles)

      treeSet.add(key(x, y));
      spawns.push({ x, y, blueprint: BlueprintType.Tree });
    }
  }

  // --- Pass 4: Rock entities ---
  for (let y = 1; y < MAP_SIZE - 1; y++) {
    for (let x = 1; x < MAP_SIZE - 1; x++) {
      if (map.getTerrain(x, y) !== Terrain.Dirt) continue;

      const adjRock =
        map.getTerrain(x - 1, y) === Terrain.Rock ||
        map.getTerrain(x + 1, y) === Terrain.Rock ||
        map.getTerrain(x, y - 1) === Terrain.Rock ||
        map.getTerrain(x, y + 1) === Terrain.Rock;
      if (!adjRock) continue;

      if (rand() < 0.15) {
        spawns.push({ x, y, blueprint: BlueprintType.Rock });
      }
    }
  }

  // --- Pass 5: Critters ---
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (map.getTerrain(x, y) !== Terrain.Grass) continue;
      if (treeSet.has(key(x, y))) continue;

      const sdx = x - SPAWN_X;
      const sdy = y - SPAWN_Y;
      if (sdx * sdx + sdy * sdy < critterClearDist) continue;

      const cv = critter.noise2d(x * critterFreq, y * critterFreq);

      if (rand() > 0.01) continue;

      const f = forest.octave2d(x * forestFreq, y * forestFreq, 3, 0.5);
      let bp: BlueprintType;
      if (f > 0.15) {
        if (cv > 0.7 && rand() < 0.3) bp = BlueprintType.Bear;
        else bp = cv > 0 ? BlueprintType.Fox : BlueprintType.Wolf;
      } else {
        bp = cv > 0 ? BlueprintType.Deer : BlueprintType.Rabbit;
      }

      spawns.push({ x, y, blueprint: bp });
    }
  }

  // --- Pass 6: Skeletons near mountains ---
  for (let y = 1; y < MAP_SIZE - 1; y++) {
    for (let x = 1; x < MAP_SIZE - 1; x++) {
      if (map.getTerrain(x, y) !== Terrain.Dirt) continue;
      if (treeSet.has(key(x, y))) continue;

      const sdx = x - SPAWN_X;
      const sdy = y - SPAWN_Y;
      if (sdx * sdx + sdy * sdy < skeletonClearDist) continue;
      if (rand() > 0.002) continue;

      const adjRock =
        map.getTerrain(x - 1, y) === Terrain.Rock ||
        map.getTerrain(x + 1, y) === Terrain.Rock ||
        map.getTerrain(x, y - 1) === Terrain.Rock ||
        map.getTerrain(x, y + 1) === Terrain.Rock;
      if (adjRock) {
        spawns.push({ x, y, blueprint: BlueprintType.Skeleton });
      }
    }
  }

  // --- Pass 7: NPCs ---
  function findNpcTile(minDist: number, maxDist: number): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = rand() * Math.PI * 2;
      const dist = minDist + rand() * (maxDist - minDist);
      const x = Math.round(SPAWN_X + Math.cos(angle) * dist);
      const y = Math.round(SPAWN_Y + Math.sin(angle) * dist);
      if (x < 1 || x >= MAP_SIZE - 1 || y < 1 || y >= MAP_SIZE - 1) continue;
      if (map.getTerrain(x, y) !== Terrain.Grass) continue;
      if (treeSet.has(key(x, y))) continue;
      return { x, y };
    }
    return null;
  }

  const hermitPos = findNpcTile(8, 15 * scale);
  if (hermitPos) spawns.push({ ...hermitPos, blueprint: BlueprintType.Hermit });

  const traderPos = findNpcTile(10, 20 * scale);
  if (traderPos) spawns.push({ ...traderPos, blueprint: BlueprintType.Trader });

  const wandererPos = findNpcTile(30 * scale, 45 * scale);
  if (wandererPos) spawns.push({ ...wandererPos, blueprint: BlueprintType.Wanderer });

  // --- Pass 8: Test building (6×6 near spawn) ---
  const bx = SPAWN_X + 5;
  const by = SPAWN_Y + 5;
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = 0; dx < 8; dx++) {
      const tx = bx + dx;
      const ty = by + dy;
      if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
      const isPerimeter = dx === 0 || (dx === 5 && dy !== 2) || dy === 0 || dy === 5;
      map.setBuilding(tx, ty, isPerimeter ? Building.Wall : Building.WoodenFloor);
      // Force grass under the building so floor blending looks clean
      map.setTerrain(tx, ty, Terrain.Grass);
    }
  }

  return { map, entitySpawns: spawns };
}
