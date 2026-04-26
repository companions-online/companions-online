// Reflective world-state dumper. Walks GameWorld's public fields, resolves
// Map/Set/TypedArray/ComponentStore, marks circular refs, and writes a
// human-readable JSON file to the world's data directory. Designed so new
// state (new Maps, new fields, new ComponentStore instances) appears in the
// dump automatically — no manual updates required.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ComponentStore } from './ecs/component-store.js';
import { EntityManager } from './ecs/entity-manager.js';
import type { GameWorld } from './game-world.js';

/** Keys omitted everywhere in the walk. Connections hold back-references to
 *  server-side plumbing (sockets, McpServer) that don't serialize; telemetry
 *  is rolling perf data, not game state; log is meta. */
const SKIP_KEYS = new Set<string>([
  'connection',   // PlayerSlot.connection — sockets/circular
  'telemetry',    // rolling buffers, not game state
  'log',          // meta, not state
]);

/** Dotted paths skipped outright. Used for the large binary grids on
 *  WorldMap — shape matters, 16 KiB byte arrays don't. */
const SKIP_PATHS = new Set<string>([
  'map.terrain',
  'map.buildings',
  'map.buildingMeta',
]);

/** EntityManager shows up only at `world.entities` — any other reference to
 *  it along the walk becomes a `{ __ref }` pointer to avoid re-dumping the
 *  whole ECS from inside PlayerSlot or similar. */
const ENTITY_MANAGER_PATH = 'entities';

const LARGE_TYPED_ARRAY_THRESHOLD = 256;

function isTypedArray(v: unknown): v is ArrayBufferView & ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

interface Ctx {
  seen: Map<object, string>;
  path: string;
}

function serialize(value: unknown, ctx: Ctx): unknown {
  // Primitives
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'bigint') return { __bigint: (value as bigint).toString() };
  if (t !== 'object' && t !== 'function') return value;
  if (t === 'function') return { __function: (value as Function).name || '<anon>' };

  const obj = value as object;

  // Circular-ref guard
  const seenPath = ctx.seen.get(obj);
  if (seenPath !== undefined) return { __ref: seenPath };
  ctx.seen.set(obj, ctx.path || '$');

  // Date
  if (obj instanceof Date) return obj.toISOString();

  // TypedArrays
  if (isTypedArray(obj)) {
    const arr = obj as unknown as { length: number; constructor: { name: string } };
    if (arr.length > LARGE_TYPED_ARRAY_THRESHOLD) {
      return { __typedArray: arr.constructor.name, length: arr.length };
    }
    return { __typedArray: arr.constructor.name, values: Array.from(obj as unknown as ArrayLike<number>) };
  }

  // Map
  if (obj instanceof Map) {
    const entries: [unknown, unknown][] = [];
    let i = 0;
    for (const [k, v] of obj) {
      entries.push([
        serialize(k, { seen: ctx.seen, path: `${ctx.path}[${i}].key` }),
        serialize(v, { seen: ctx.seen, path: `${ctx.path}[${i}].value` }),
      ]);
      i++;
    }
    return { __map: entries };
  }

  // Set
  if (obj instanceof Set) {
    const values: unknown[] = [];
    let i = 0;
    for (const v of obj) {
      values.push(serialize(v, { seen: ctx.seen, path: `${ctx.path}[${i}]` }));
      i++;
    }
    return { __set: values };
  }

  // ComponentStore — custom iterable of [eid, data]
  if (obj instanceof ComponentStore) {
    const entries: [number, unknown][] = [];
    let i = 0;
    for (const [eid, data] of obj) {
      entries.push([eid, serialize(data, { seen: ctx.seen, path: `${ctx.path}[${i}].value` })]);
      i++;
    }
    return { __componentStore: entries };
  }

  // EntityManager: only dumped in full at `world.entities`. Elsewhere collapse
  // to a ref marker so a rogue PlayerSlot or system-state back-ref doesn't
  // re-emit the whole ECS.
  if (obj instanceof EntityManager && ctx.path !== ENTITY_MANAGER_PATH) {
    return { __ref: ENTITY_MANAGER_PATH };
  }

  // Arrays
  if (Array.isArray(obj)) {
    return obj.map((v, i) => serialize(v, { seen: ctx.seen, path: `${ctx.path}[${i}]` }));
  }

  // toJSON override (e.g. on any plain wrapper objects). Don't call it on
  // our custom types above — we've already handled those.
  const maybeToJSON = (obj as { toJSON?: () => unknown }).toJSON;
  if (typeof maybeToJSON === 'function') {
    return serialize(maybeToJSON.call(obj), ctx);
  }

  // Plain object — walk own enumerable keys. Covers class instances too
  // (TypeScript `private` is type-only; runtime fields are enumerable).
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (SKIP_KEYS.has(key)) continue;
    const childPath = ctx.path ? `${ctx.path}.${key}` : key;
    if (SKIP_PATHS.has(childPath)) continue;
    const child = (obj as Record<string, unknown>)[key];
    out[key] = serialize(child, { seen: ctx.seen, path: childPath });
  }
  return out;
}

/** Pure serialization — returns a JSON-safe tree without touching disk.
 *  Exposed for tests. */
export function serializeWorld(world: GameWorld): unknown {
  return serialize(world, { seen: new Map(), path: '' });
}

/** Dump `world` to `<worldDir>/<ISO-timestamp>-dump.json`. Returns the full
 *  path to the written file. */
export async function dumpWorld(world: GameWorld, worldDir: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}-dump.json`;
  const filepath = join(worldDir, filename);
  const payload = serializeWorld(world);
  await writeFile(filepath, JSON.stringify(payload, null, 2));
  return filepath;
}
