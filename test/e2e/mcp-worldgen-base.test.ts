// Regression: worldgen's test-base resources (Wood/Rock/Iron/Hide/RawMeat/
// RawFish) and its placed campfires/doors must appear in the MCP
// <entities> block under the right buckets. Prior bug: ground-item
// resources were spawned through spawnCreatureEntity, which set a
// statusEffects component on them; categorizeEntity's "no statusEffects =
// ground item" heuristic then rejected them, and they were silently
// dropped from the response even though the <map> still drew them.
//
// After the fix: resources/items route through spawnGroundItem (no
// statusEffects component), placeable worldgen spawns get
// StatusEffect.Placed, and categorizeEntity keys purely on category +
// Placed bit.

import { describe, it, expect } from 'vitest';
import { SPAWN_X, SPAWN_Y } from '../../shared/src/constants.js';
import { MetaKey } from '../../shared/src/entity-meta.js';
import { createDefaultWorld } from '../../server/src/game-world.js';
import { McpConnection } from '../../server/src/connections/mcp-connection.js';
import { formatEnvelope, ResponseShape } from '../../server/src/mcp-formatters.js';

function spawnMcpPlayerInsideBase(): { conn: McpConnection; envelope: string } {
  const world = createDefaultWorld(42);

  // The worldgen test base sits at (bx, by) = (SPAWN_X+5, SPAWN_Y+5) and
  // extends 6 tiles on each side. Park the player at the center tile
  // (bx+3, by+3) — not literally on a spawned ground item, but inside the
  // walls and within viewRange of every base entity.
  const conn = new McpConnection();
  const eid = world.addPlayer(conn);
  world.setEntityMeta(eid, MetaKey.Name, 'Tester');

  // Teleport into the base. addPlayer set occupancy at the auto-picked
  // spawn tile; clear it before re-seating so the grid stays consistent.
  const oldPos = world.entities.position.get(eid)!;
  world.occupancy.clear(oldPos.tileX, oldPos.tileY);
  const tx = SPAWN_X + 5 + 4;
  const ty = SPAWN_Y + 5 + 2;
  world.entities.position.set(eid, { tileX: tx, tileY: ty });
  world.occupancy.set(tx, ty, eid);

  // Ensure the connection sees the fresh position.
  conn.onInitialState(eid, world);

  const envelope = formatEnvelope(conn, null, ResponseShape.Full);
  return { conn, envelope };
}

function section(envelope: string, header: string): string {
  // Return everything between "-- <header> --" and the next "-- " marker
  // (or end of <entities>). Good enough for bucket-membership assertions.
  const start = envelope.indexOf(`-- ${header} --`);
  if (start < 0) return '';
  const rest = envelope.slice(start + header.length + 6);
  const nextHeader = rest.match(/\n-- [a-z ]+ --|\n<\/entities>/);
  return nextHeader ? rest.slice(0, nextHeader.index!) : rest;
}

describe('MCP worldgen base: ground items vs structures', () => {
  it('lists all 6 test-base resource ground items under "ground items"', () => {
    const { envelope } = spawnMcpPlayerInsideBase();
    const ground = section(envelope, 'ground items');

    // Each resource is dropped as one entity on worldgen (no stacking).
    expect(ground).toContain('wood#');
    expect(ground).toContain('rock#');
    expect(ground).toContain('iron#');
    expect(ground).toContain('hide#');
    expect(ground).toContain('raw meat#');
    expect(ground).toContain('raw fish#');
  });

  it('lists the 2 base Campfires under "structures"', () => {
    const { envelope } = spawnMcpPlayerInsideBase();
    const structures = section(envelope, 'structures');

    // Both worldgen campfires are in view from the base center.
    const campfireMatches = structures.match(/campfire#\d+/g) ?? [];
    expect(campfireMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('lists both Wooden Doors under "structures"', () => {
    const { envelope } = spawnMcpPlayerInsideBase();
    const structures = section(envelope, 'structures');

    const doorMatches = structures.match(/wooden door#\d+/g) ?? [];
    expect(doorMatches.length).toBe(2);
  });

  it('does not mis-file any base resource under "structures"', () => {
    const { envelope } = spawnMcpPlayerInsideBase();
    const structures = section(envelope, 'structures');

    for (const name of ['wood#', 'rock#', 'iron#', 'hide#', 'raw meat#', 'raw fish#']) {
      expect(structures).not.toContain(name);
    }
  });
});
