// world-dump-view: slice-and-dice utility for dashboard `d` dumps.
//
// Usage:
//   npx tsx scripts/world-dump-view.ts <path> [command] [args]
//
// <path> can be either a dump JSON file, or a world directory (most recent
// *-dump.json is picked automatically).
//
// Commands:
//   overview             (default) — tick, players, entity counts, stuck-invariant scan.
//   stuck                Scan for components/states that violate tick invariants:
//                        currentAction=Walking with no moveState, etc.
//   near <x> <y> [r=6]   All entities within Chebyshev r of the tile.
//   entity <eid>         Every component + every state-map row that mentions this eid.
//   find <bp>            All positions of a given blueprint (by numeric id or name).
//   state <mapName> [eid]  Dump a specific state Map: all rows, or one eid.
//   keys                 List every top-level key in the dump.
//
// Designed for one-shot forensics. If you find yourself writing a new query
// more than once, turn it into a command here.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BlueprintType } from '../shared/src/blueprints.js';
import { ActionType } from '../shared/src/actions.js';

// ---------------------------------------------------------------------------
// Dump loader + marker unwrapping
// ---------------------------------------------------------------------------

interface Dump {
  [k: string]: any;
}

/** Result of unwrapping a `__map` / `__componentStore` marker — both are
 *  `{ __map: [[k, v], ...] }` shape in the dump JSON. */
type EntryList = [any, any][];

function loadDump(pathArg: string): { dump: Dump; sourcePath: string } {
  let path = pathArg;
  const s = statSync(path);
  if (s.isDirectory()) {
    const dumps = readdirSync(path)
      .filter(f => f.endsWith('-dump.json'))
      .sort(); // ISO timestamp prefix sorts chronologically
    if (dumps.length === 0) throw new Error(`no *-dump.json files in ${path}`);
    path = join(path, dumps[dumps.length - 1]);
  }
  const raw = readFileSync(path, 'utf-8');
  return { dump: JSON.parse(raw), sourcePath: path };
}

/** Unwrap `{__map: [[k,v],...]}` or `{__componentStore: [[eid,v],...]}` or
 *  `{__set: [...]}` into a usable JS structure. Returns the value as-is if
 *  unmarked. */
function unwrap(v: any): any {
  if (!v || typeof v !== 'object') return v;
  if ('__map' in v) return new Map(v.__map as EntryList);
  if ('__componentStore' in v) return new Map(v.__componentStore as EntryList);
  if ('__set' in v) return new Set(v.__set);
  if ('__typedArray' in v) return v; // leave stub as-is
  if ('__ref' in v) return v;
  return v;
}

function asMap<K = number, V = any>(v: any): Map<K, V> {
  const m = unwrap(v);
  if (!(m instanceof Map)) throw new Error(`expected a __map/__componentStore marker, got ${typeof v}`);
  return m as Map<K, V>;
}

// ---------------------------------------------------------------------------
// Domain accessors over a dump
// ---------------------------------------------------------------------------

class DumpView {
  constructor(public readonly dump: Dump) {}

  component<T = any>(name: string): Map<number, T> {
    const ent = this.dump.entities;
    if (!ent || !(name in ent)) throw new Error(`no component '${name}' on dump.entities`);
    return asMap<number, T>(ent[name]);
  }

  stateMap<T = any>(name: string): Map<number, T> {
    if (!(name in this.dump)) throw new Error(`no top-level key '${name}' on dump`);
    return asMap<number, T>(this.dump[name]);
  }

  players(): number[] {
    return [...asMap<number, any>(this.dump.players).keys()];
  }

  allEntityIds(): number[] {
    return [...this.component('position').keys()];
  }

  blueprintOf(eid: number): number | undefined {
    return this.component<{ blueprintId: number }>('blueprint').get(eid)?.blueprintId;
  }

  describeEntity(eid: number): Record<string, any> {
    const components = ['position', 'direction', 'nextWaypoint', 'currentAction', 'health', 'blueprint', 'statusEffects'];
    const out: Record<string, any> = { eid };
    for (const c of components) {
      const m = this.component(c);
      if (m.has(eid)) out[c] = m.get(eid);
    }
    // Also include any state-map rows that reference this eid.
    const stateMapNames = ['moveStates', 'harvestStates', 'combatStates', 'consumableStates', 'critterStates', 'treeResources'];
    for (const name of stateMapNames) {
      if (!(name in this.dump)) continue;
      const m = asMap(this.dump[name]);
      if (m.has(eid)) out[name] = m.get(eid);
    }
    // Inventory (player / chest).
    const inv = this.dump.inventoryMgr;
    if (inv?.inventories) {
      const invMap = asMap(inv.inventories);
      if (invMap.has(eid)) out.inventory = invMap.get(eid);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Name lookups — numeric enums only ship as numbers in the dump.
// ---------------------------------------------------------------------------

const BLUEPRINT_NAME_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(BlueprintType)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => [v as number, k]),
);

const ACTION_NAME_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(ActionType)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => [v as number, k]),
);

function bpName(id: number | undefined): string {
  if (id === undefined) return '?';
  return BLUEPRINT_NAME_BY_ID[id] ?? `bp#${id}`;
}

function actionName(t: number | undefined): string {
  if (t === undefined) return '?';
  return ACTION_NAME_BY_ID[t] ?? `action#${t}`;
}

function resolveBlueprintArg(arg: string): number {
  // Numeric shortcut.
  const n = Number(arg);
  if (Number.isFinite(n)) return n;
  // Name lookup (case-insensitive).
  const entry = Object.entries(BLUEPRINT_NAME_BY_ID).find(([, name]) =>
    name.toLowerCase() === arg.toLowerCase(),
  );
  if (entry) return Number(entry[0]);
  throw new Error(`unknown blueprint '${arg}' — pass numeric id or enum name (Wolf/Skeleton/etc)`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdOverview(v: DumpView): void {
  const seed = v.dump.seed;
  const tick = v.dump._tick;
  const weather = v.dump.weather;
  const tickOffset = v.dump.tickOffset;
  console.log(`seed=${seed} tick=${tick} tickOffset=${tickOffset} weather=${weather}`);

  const players = v.players();
  const pos = v.component<{ tileX: number; tileY: number }>('position');
  const act = v.component<{ actionType: number }>('currentAction');
  console.log(`\nplayers (${players.length}):`);
  for (const pid of players) {
    const p = pos.get(pid);
    const a = act.get(pid);
    console.log(`  ${pid}  pos=${p?.tileX},${p?.tileY}  action=${actionName(a?.actionType)}`);
  }

  // Entity breakdown by blueprint.
  const counts = new Map<number, number>();
  for (const [, bp] of v.component<{ blueprintId: number }>('blueprint')) {
    counts.set(bp.blueprintId, (counts.get(bp.blueprintId) ?? 0) + 1);
  }
  console.log(`\nentities by blueprint (${[...counts.values()].reduce((a, b) => a + b, 0)} total):`);
  for (const [id, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bpName(id).padEnd(18)} ${String(n).padStart(4)}`);
  }

  // Critter behavior tally.
  if (v.dump.critterStates) {
    const cs = asMap<number, { behavior: string }>(v.dump.critterStates);
    const byBehavior = new Map<string, number>();
    for (const [, s] of cs) byBehavior.set(s.behavior, (byBehavior.get(s.behavior) ?? 0) + 1);
    console.log(`\ncritter behaviors:`);
    for (const [b, n] of byBehavior) console.log(`  ${b.padEnd(10)} ${n}`);
  }

  cmdStuck(v);
}

function cmdStuck(v: DumpView): void {
  // Invariant scan: flag any entity whose visible state contradicts the
  // system that should own it.
  const act = v.component<{ actionType: number }>('currentAction');
  const pos = v.component<{ tileX: number; tileY: number }>('position');
  const bp = v.component<{ blueprintId: number }>('blueprint');
  const moves = v.dump.moveStates ? asMap<number, any>(v.dump.moveStates) : new Map();
  const harvests = v.dump.harvestStates ? asMap<number, any>(v.dump.harvestStates) : new Map();
  const combats = v.dump.combatStates ? asMap<number, any>(v.dump.combatStates) : new Map();
  const consumes = v.dump.consumableStates ? asMap<number, any>(v.dump.consumableStates) : new Map();

  const violations: string[] = [];
  for (const [eid, a] of act) {
    const t = a.actionType;
    const p = pos.get(eid);
    const name = bpName(bp.get(eid)?.blueprintId);
    const loc = p ? `@${p.tileX},${p.tileY}` : '';
    if (t === ActionType.Walking && !moves.has(eid)) {
      violations.push(`  ${eid} ${name} ${loc}: Walking but no moveState`);
    }
    if (t === ActionType.Harvesting && !harvests.has(eid)) {
      violations.push(`  ${eid} ${name} ${loc}: Harvesting but no harvestState`);
    }
    if (t === ActionType.Attacking && !combats.has(eid)) {
      violations.push(`  ${eid} ${name} ${loc}: Attacking but no combatState`);
    }
    if (t === ActionType.Consuming && !consumes.has(eid)) {
      violations.push(`  ${eid} ${name} ${loc}: Consuming but no consumableState`);
    }
  }

  console.log(`\nstuck-state invariant scan (${violations.length} violations):`);
  if (violations.length === 0) console.log('  [clean]');
  else for (const v of violations) console.log(v);
}

function cmdNear(v: DumpView, args: string[]): void {
  if (args.length < 2) throw new Error('near: usage near <x> <y> [radius=6]');
  const cx = Number(args[0]), cy = Number(args[1]);
  const r = args[2] !== undefined ? Number(args[2]) : 6;
  const pos = v.component<{ tileX: number; tileY: number }>('position');
  const bp = v.component<{ blueprintId: number }>('blueprint');
  const act = v.component<{ actionType: number }>('currentAction');

  const rows: Array<{ eid: number; name: string; x: number; y: number; dx: number; dy: number; a: string }> = [];
  for (const [eid, p] of pos) {
    const dx = p.tileX - cx, dy = p.tileY - cy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > r) continue;
    rows.push({
      eid,
      name: bpName(bp.get(eid)?.blueprintId),
      x: p.tileX, y: p.tileY, dx, dy,
      a: actionName(act.get(eid)?.actionType),
    });
  }
  rows.sort((a, b) => Math.max(Math.abs(a.dx), Math.abs(a.dy)) - Math.max(Math.abs(b.dx), Math.abs(b.dy)));
  console.log(`entities within r=${r} of ${cx},${cy} (${rows.length}):`);
  for (const row of rows) {
    console.log(`  ${String(row.eid).padStart(4)}  ${row.name.padEnd(14)}  @${row.x},${row.y} (${row.dx >= 0 ? '+' : ''}${row.dx},${row.dy >= 0 ? '+' : ''}${row.dy})  ${row.a}`);
  }
}

function cmdEntity(v: DumpView, args: string[]): void {
  if (args.length < 1) throw new Error('entity: usage entity <eid>');
  const eid = Number(args[0]);
  const info = v.describeEntity(eid);
  // Friendly annotations.
  if (info.blueprint) info.blueprint = { ...info.blueprint, name: bpName(info.blueprint.blueprintId) };
  if (info.currentAction) info.currentAction = { ...info.currentAction, name: actionName(info.currentAction.actionType) };
  console.log(JSON.stringify(info, null, 2));
}

function cmdFind(v: DumpView, args: string[]): void {
  if (args.length < 1) throw new Error('find: usage find <blueprintNameOrId>');
  const id = resolveBlueprintArg(args[0]);
  const bp = v.component<{ blueprintId: number }>('blueprint');
  const pos = v.component<{ tileX: number; tileY: number }>('position');
  const act = v.component<{ actionType: number }>('currentAction');
  const rows: Array<{ eid: number; x: number; y: number; a: string }> = [];
  for (const [eid, b] of bp) {
    if (b.blueprintId !== id) continue;
    const p = pos.get(eid);
    rows.push({ eid, x: p?.tileX ?? -1, y: p?.tileY ?? -1, a: actionName(act.get(eid)?.actionType) });
  }
  console.log(`${bpName(id)} entities (${rows.length}):`);
  for (const r of rows) console.log(`  ${String(r.eid).padStart(4)}  @${r.x},${r.y}  ${r.a}`);
}

function cmdState(v: DumpView, args: string[]): void {
  if (args.length < 1) throw new Error('state: usage state <mapName> [eid]');
  const name = args[0];
  const m = v.stateMap(name);
  if (args[1] !== undefined) {
    const eid = Number(args[1]);
    const row = m.get(eid);
    if (row === undefined) { console.log(`no ${name} entry for eid=${eid}`); return; }
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  console.log(`${name} (${m.size} entries):`);
  for (const [k, val] of m) {
    console.log(`  ${k}: ${JSON.stringify(val)}`);
  }
}

function cmdKeys(v: DumpView): void {
  console.log('top-level keys:');
  for (const k of Object.keys(v.dump)) {
    const val = v.dump[k];
    let tag = typeof val;
    if (val && typeof val === 'object') {
      if ('__map' in val) tag = `__map(${val.__map.length})`;
      else if ('__set' in val) tag = `__set(${val.__set.length})`;
      else if ('__componentStore' in val) tag = `__componentStore(${val.__componentStore.length})`;
      else if ('__typedArray' in val) tag = `__typedArray(${val.__typedArray}, len=${val.length ?? '?'})`;
      else if (Array.isArray(val)) tag = `array(${val.length})`;
      else tag = `object(${Object.keys(val).length} keys)`;
    }
    console.log(`  ${k.padEnd(24)} ${tag}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(`usage: npx tsx scripts/world-dump-view.ts <path> [command] [args]

<path> can be a dump JSON file or a world directory (latest dump is used).

Commands:
  overview             (default) player + entity breakdown + stuck-state scan
  stuck                invariant scan only
  near <x> <y> [r=6]
  entity <eid>
  find <bp-name-or-id>
  state <mapName> [eid]
  keys                 list top-level keys in the dump`);
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 1) usage();

const [pathArg, cmd = 'overview', ...rest] = argv;
const { dump, sourcePath } = loadDump(pathArg);
const v = new DumpView(dump);
console.log(`[source] ${sourcePath}`);

switch (cmd) {
  case 'overview': cmdOverview(v); break;
  case 'stuck':    cmdStuck(v); break;
  case 'near':     cmdNear(v, rest); break;
  case 'entity':   cmdEntity(v, rest); break;
  case 'find':     cmdFind(v, rest); break;
  case 'state':    cmdState(v, rest); break;
  case 'keys':     cmdKeys(v); break;
  default:
    console.error(`unknown command '${cmd}'`);
    usage();
}
