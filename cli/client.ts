import WebSocket from 'ws';
import { MAP_SIZE, CHUNK_SIZE, VIEW_RANGE } from '../shared/src/constants.js';
import { Terrain, Building } from '../shared/src/terrain.js';
import { tileChar } from '../shared/src/ascii.js';
import { BlueprintType } from '../shared/src/blueprints.js';
import { ClientAction } from '../shared/src/actions.js';
import {
  decodeServerMessage, encodeAction,
} from '../shared/src/protocol/codec.js';
import type { EntityComponents, DecodedAction } from '../shared/src/protocol/codec.js';
import { resolveAction } from '../shared/src/action-resolver.js';

// --- State ---
const terrain = new Uint8Array(MAP_SIZE * MAP_SIZE);
const buildings = new Uint8Array(MAP_SIZE * MAP_SIZE);
const entityMap = new Map<number, EntityComponents & { speed?: number }>();

let myEntityId = 0;
let cursorDX = 0;
let cursorDY = 0;
let lastTick = 0;
let debugMode = false;
const debugLog: string[] = [];
const DEBUG_MAX = 200;

function dbg(line: string) {
  debugLog.push(line);
  if (debugLog.length > DEBUG_MAX) debugLog.shift();
}

// --- Connect ---
const host = process.argv[2] || 'localhost:3001';
const ws = new WebSocket(`ws://${host}`);
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  dbg('-- connected --');
  render();
});

ws.on('message', (data) => {
  const buf = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
  const msg = decodeServerMessage(buf);

  switch (msg.type) {
    case 'welcome':
      myEntityId = msg.entityId;
      dbg(`← Welcome id=${msg.entityId}`);
      break;

    case 'chunk': {
      const { chunkX, chunkY, terrain: t, buildings: b } = msg.data;
      const sx = chunkX * CHUNK_SIZE;
      const sy = chunkY * CHUNK_SIZE;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const gi = (sy + ly) * MAP_SIZE + (sx + lx);
          const ci = ly * CHUNK_SIZE + lx;
          terrain[gi] = t[ci];
          buildings[gi] = b[ci];
        }
      }
      dbg(`← Chunk (${chunkX},${chunkY})`);
      break;
    }

    case 'entityFullState': {
      const { entityId, components, speed } = msg.data;
      entityMap.set(entityId, { ...components, speed });
      const pos = components.position;
      const bpId = components.blueprintId?.blueprintId;
      dbg(`← FullState #${entityId} bp=${bpId ?? '?'} pos=${pos ? `(${pos.tileX},${pos.tileY})` : '?'}`);
      break;
    }

    case 'worldDelta': {
      const d = msg.data;
      lastTick = d.tick;
      for (const eu of d.entityUpdates) {
        const existing = entityMap.get(eu.entityId) ?? {};
        entityMap.set(eu.entityId, { ...existing, ...eu.components });
      }
      for (const rid of d.entityRemovals) {
        entityMap.delete(rid);
      }
      dbg(`← Delta t=${d.tick} upd=${d.entityUpdates.length} rem=${d.entityRemovals.length}`);
      break;
    }

    case 'pong':
      break;
  }

  render();
});

ws.on('close', () => {
  cleanup();
  console.log('Disconnected.');
  process.exit(0);
});

ws.on('error', (err) => {
  cleanup();
  console.error('Connection error:', err.message);
  process.exit(1);
});

// --- Rendering ---
function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const myEntity = entityMap.get(myEntityId);
  const playerX = myEntity?.position?.tileX ?? 0;
  const playerY = myEntity?.position?.tileY ?? 0;

  const statusRows = 2;
  const mapRows = rows - statusRows;

  const debugWidth = debugMode ? 42 : 0;
  const mapCols = cols - debugWidth;

  const halfW = Math.floor(mapCols / 2);
  const halfH = Math.floor(mapRows / 2);

  // Build entity position lookup
  const entityAtTile = new Map<number, number>(); // tileKey → blueprintType
  for (const [eid, comp] of entityMap) {
    if (comp.position && comp.blueprintId !== undefined) {
      const bpId = typeof comp.blueprintId === 'number'
        ? comp.blueprintId
        : (comp.blueprintId as { blueprintId: number }).blueprintId;
      entityAtTile.set(comp.position.tileY * MAP_SIZE + comp.position.tileX, bpId);
    }
  }

  let out = '\x1b[H'; // cursor home (no clear — overwrite in place)

  for (let vy = 0; vy < mapRows; vy++) {
    const wy = playerY - halfH + vy;
    let line = '';

    for (let vx = 0; vx < mapCols; vx++) {
      const wx = playerX - halfW + vx;
      const dx = vx - halfW;
      const dy = vy - halfH;
      const isCursor = dx === cursorDX && dy === cursorDY;

      let ch: string;
      if (wx < 0 || wx >= MAP_SIZE || wy < 0 || wy >= MAP_SIZE) {
        ch = ' ';
      } else {
        const gi = wy * MAP_SIZE + wx;
        const t = terrain[gi] as Terrain;
        const b = buildings[gi] as Building;
        const ent = entityAtTile.get(gi) as BlueprintType | undefined;
        ch = tileChar(t, b, ent);
      }

      if (isCursor) {
        line += `\x1b[7m${ch}\x1b[0m`;
      } else {
        line += ch;
      }
    }

    // Debug panel
    if (debugMode) {
      line += '\x1b[90m│\x1b[0m';
      const dbgIdx = debugLog.length - mapRows + vy;
      const dbgLine = dbgIdx >= 0 && dbgIdx < debugLog.length ? debugLog[dbgIdx] : '';
      line += dbgLine.slice(0, debugWidth - 2).padEnd(debugWidth - 2);
    }

    out += line + '\n';
  }

  // Status bar
  const cursorWorldX = playerX + cursorDX;
  const cursorWorldY = playerY + cursorDY;
  const status1 = ` Player (${playerX},${playerY}) | Cursor (${cursorWorldX},${cursorWorldY}) | Entities: ${entityMap.size} | Tick: ${lastTick}`;
  const status2 = ` [arrows] move cursor  [enter] act  [d] debug  [q] quit`;

  out += `\x1b[7m${status1.padEnd(cols)}\x1b[0m\n`;
  out += `\x1b[7m${status2.padEnd(cols)}\x1b[0m`;

  process.stdout.write(out);
}

// --- Input ---
process.stdin.setRawMode!(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdout.write('\x1b[?25l'); // hide cursor
process.stdout.write('\x1b[2J');   // clear screen

process.stdin.on('data', (key: string) => {
  if (key === 'q' || key === '\x03') { // q or Ctrl-C
    cleanup();
    ws.close();
    process.exit(0);
  }

  if (key === 'd') {
    debugMode = !debugMode;
    process.stdout.write('\x1b[2J'); // clear on toggle
    render();
    return;
  }

  const maxRange = Math.floor(VIEW_RANGE / 2);

  if (key === '\x1b[A') { cursorDY = Math.max(-maxRange, cursorDY - 1); }
  else if (key === '\x1b[B') { cursorDY = Math.min(maxRange, cursorDY + 1); }
  else if (key === '\x1b[C') { cursorDX = Math.min(maxRange, cursorDX + 1); }
  else if (key === '\x1b[D') { cursorDX = Math.max(-maxRange, cursorDX - 1); }
  else if (key === '\r' || key === '\n') {
    doAction();
    return;
  }
  else return;

  render();
});

function doAction() {
  const myEntity = entityMap.get(myEntityId);
  if (!myEntity?.position) return;

  const tx = myEntity.position.tileX + cursorDX;
  const ty = myEntity.position.tileY + cursorDY;

  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return;

  const gi = ty * MAP_SIZE + tx;
  const isWalkable = !(
    terrain[gi] === Terrain.Water ||
    terrain[gi] === Terrain.Rock ||
    terrain[gi] === Terrain.River
  ) && (
    buildings[gi] === Building.None ||
    buildings[gi] === Building.Floor ||
    buildings[gi] === Building.Door
  );

  const action = resolveAction({
    targetX: tx,
    targetY: ty,
    isWalkable,
  });

  if (action && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeAction(action));
    dbg(`→ Action MoveTo (${tx},${ty})`);
    render();
  }
}

function cleanup() {
  process.stdout.write('\x1b[?25h'); // show cursor
  process.stdout.write('\x1b[0m');   // reset attributes
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
}
