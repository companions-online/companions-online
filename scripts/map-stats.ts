import { generateWorld } from '../shared/src/world/world-gen.js';
import { Terrain } from '../shared/src/terrain.js';
import { BlueprintType } from '../shared/src/blueprints.js';
import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '../shared/src/constants.js';
import { PerlinNoise } from '../shared/src/world/noise.js';

const seed = parseInt(process.argv[2] ?? '', 10) || 44;
console.log(`Map stats for seed=${seed}, MAP_SIZE=${MAP_SIZE}\n`);

// --- Generate world ---
const { map, entitySpawns } = generateWorld(seed);
const total = MAP_SIZE * MAP_SIZE;

// --- Terrain distribution ---
let grass = 0, dirt = 0, rock = 0, water = 0, sand = 0, river = 0;
for (let y = 0; y < MAP_SIZE; y++) {
  for (let x = 0; x < MAP_SIZE; x++) {
    const t = map.getTerrain(x, y);
    if (t === Terrain.Grass) grass++;
    else if (t === Terrain.Dirt) dirt++;
    else if (t === Terrain.Rock) rock++;
    else if (t === Terrain.Water) water++;
    else if (t === Terrain.Sand) sand++;
    else if (t === Terrain.River) river++;
  }
}

const pct = (n: number) => ((n / total) * 100).toFixed(1) + '%';

console.log('TERRAIN DISTRIBUTION');
console.log(`  Grass:  ${String(grass).padStart(6)}  ${pct(grass).padStart(6)}`);
console.log(`  Dirt:   ${String(dirt).padStart(6)}  ${pct(dirt).padStart(6)}`);
console.log(`  Rock:   ${String(rock).padStart(6)}  ${pct(rock).padStart(6)}`);
console.log(`  Sand:   ${String(sand).padStart(6)}  ${pct(sand).padStart(6)}`);
console.log(`  Water:  ${String(water).padStart(6)}  ${pct(water).padStart(6)}`);
console.log(`  River:  ${String(river).padStart(6)}  ${pct(river).padStart(6)}`);
console.log(`  Total:  ${String(total).padStart(6)}`);

// --- Dirt tiles adjacent to Rock (rock entity candidate pool) ---
let dirtAdjRock = 0;
for (let y = 1; y < MAP_SIZE - 1; y++) {
  for (let x = 1; x < MAP_SIZE - 1; x++) {
    if (map.getTerrain(x, y) !== Terrain.Dirt) continue;
    if (map.getTerrain(x - 1, y) === Terrain.Rock ||
        map.getTerrain(x + 1, y) === Terrain.Rock ||
        map.getTerrain(x, y - 1) === Terrain.Rock ||
        map.getTerrain(x, y + 1) === Terrain.Rock) {
      dirtAdjRock++;
    }
  }
}
console.log(`\nDirt adjacent to Rock: ${dirtAdjRock} (rock entity candidate pool)`);

// --- Elevation analysis ---
const scale = MAP_SIZE / 128;
const elevation = new PerlinNoise(seed);
const elevFreq = 0.03 / scale;
const cx = MAP_SIZE / 2, cy = MAP_SIZE / 2;
const maxDist = MAP_SIZE * 0.45;

let maxE = -Infinity, minE = Infinity;
for (let y = 0; y < MAP_SIZE; y++) {
  for (let x = 0; x < MAP_SIZE; x++) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));
    const raw = (elevation.octave2d(x * elevFreq, y * elevFreq, 4, 0.5) + 1) / 2;
    const e = raw - (1 - mask);
    if (e > maxE) maxE = e;
    if (e < minE) minE = e;
  }
}

console.log(`\nELEVATION RANGE`);
console.log(`  Min: ${minE.toFixed(4)}  Max: ${maxE.toFixed(4)}`);
console.log(`  Current thresholds: Rock > 0.65, Dirt > 0.50`);

console.log(`\n  Tiles at elevation thresholds:`);
for (const thresh of [0.65, 0.60, 0.55, 0.50, 0.45, 0.40]) {
  let count = 0;
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));
      const raw = (elevation.octave2d(x * elevFreq, y * elevFreq, 4, 0.5) + 1) / 2;
      const e = raw - (1 - mask);
      if (e > thresh) count++;
    }
  }
  console.log(`    e > ${thresh.toFixed(2)}: ${String(count).padStart(6)} tiles  ${pct(count).padStart(6)}`);
}

// --- Entity distribution ---
const counts = new Map<string, number>();
const bpNames: Record<number, string> = {
  [BlueprintType.Tree]: 'Tree',
  [BlueprintType.Rock]: 'Rock',
  [BlueprintType.Deer]: 'Deer',
  [BlueprintType.Rabbit]: 'Rabbit',
  [BlueprintType.Fox]: 'Fox',
  [BlueprintType.Wolf]: 'Wolf',
  [BlueprintType.Bear]: 'Bear',
  [BlueprintType.Skeleton]: 'Skeleton',
  [BlueprintType.Hermit]: 'Hermit',
  [BlueprintType.Trader]: 'Trader',
  [BlueprintType.Wanderer]: 'Wanderer',
};

for (const s of entitySpawns) {
  const name = bpNames[s.blueprint] ?? `bp${s.blueprint}`;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

console.log(`\nENTITY DISTRIBUTION (${entitySpawns.length} total)`);
for (const [name, c] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(12)} ${String(c).padStart(5)}`);
}

// --- Spawn area analysis ---
const spawnR = 10;
let walkableNearSpawn = 0, totalNearSpawn = 0;
for (let dy = -spawnR; dy <= spawnR; dy++) {
  for (let dx = -spawnR; dx <= spawnR; dx++) {
    const sx = SPAWN_X + dx, sy = SPAWN_Y + dy;
    if (sx < 0 || sx >= MAP_SIZE || sy < 0 || sy >= MAP_SIZE) continue;
    totalNearSpawn++;
    if (map.isWalkable(sx, sy)) walkableNearSpawn++;
  }
}
console.log(`\nSPAWN AREA (${spawnR}-tile radius around ${SPAWN_X},${SPAWN_Y})`);
console.log(`  Walkable: ${walkableNearSpawn}/${totalNearSpawn}`);
