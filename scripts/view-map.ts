import { generateWorld } from '../shared/src/world/world-gen.js';
import { tileChar } from '../shared/src/ascii.js';
import { BlueprintType } from '../shared/src/blueprints.js';
import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '../shared/src/constants.js';

const seed = parseInt(process.argv[2] ?? '', 10) || (Date.now() & 0xFFFFFFFF);
console.log(`Generating world with seed: ${seed}`);

const { map, entitySpawns } = generateWorld(seed);

// Build entity lookup: position → blueprint
const entityAt = new Map<number, BlueprintType>();
for (const s of entitySpawns) {
  entityAt.set(s.y * MAP_SIZE + s.x, s.blueprint);
}
// Place player at spawn
entityAt.set(SPAWN_Y * MAP_SIZE + SPAWN_X, BlueprintType.Player);

// Terminal size
const cols = process.stdout.columns || 80;
const rows = (process.stdout.rows || 24) - 2; // reserve for header/footer

// Viewport centered on spawn, clamped to map bounds
const vpW = Math.min(cols, MAP_SIZE);
const vpH = Math.min(rows, MAP_SIZE);
const startX = Math.max(0, Math.min(SPAWN_X - Math.floor(vpW / 2), MAP_SIZE - vpW));
const startY = Math.max(0, Math.min(SPAWN_Y - Math.floor(vpH / 2), MAP_SIZE - vpH));

// Render
const lines: string[] = [];
for (let vy = 0; vy < vpH; vy++) {
  let line = '';
  for (let vx = 0; vx < vpW; vx++) {
    const x = startX + vx;
    const y = startY + vy;
    const terrain = map.getTerrain(x, y);
    const building = map.getBuilding(x, y);
    const entity = entityAt.get(y * MAP_SIZE + x);
    line += tileChar(terrain, building, entity);
  }
  lines.push(line);
}

// Stats
let trees = 0, rocks = 0, critters = 0;
for (const s of entitySpawns) {
  if (s.blueprint === BlueprintType.Tree) trees++;
  else if (s.blueprint === BlueprintType.Rock) rocks++;
  else critters++;
}

console.log(lines.join('\n'));
console.log(`seed=${seed} viewport=${vpW}x${vpH} at (${startX},${startY}) | ${trees} trees, ${rocks} rocks, ${critters} critters`);
