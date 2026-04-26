import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree } from '../../../test/e2e/helpers.js';
import { Scoreboard } from '../../eval/scoreboard.js';
import { ClientAction } from '../../../shared/src/actions.js';
import { BlueprintType } from '../../../shared/src/blueprints.js';
import type { Checkpoint } from '../../eval/match.js';

const checkpoints: Checkpoint[] = [
  { id: 'harvest_tree', event: 'harvest_yield', match: { resourceName: 'Wood' } },
];

describe('Scoreboard', () => {
  it('resolves AI eid and records hit when AI harvests a tree', () => {
    const world = createTestWorld();
    // Pre-existing player (noise) so we can verify the snapshot-diff logic.
    addTestPlayer(world, 30, 30);
    const playersBefore = new Set(world.players.keys());

    // AI joins after the snapshot.
    const { entityId: ai } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(ai, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(ai)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(ai, axe.itemId);
    placeTree(world, 11, 10);

    const sb = new Scoreboard(world, checkpoints, playersBefore);
    sb.attach();

    world.setAction(ai, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(200);

    expect(sb.getAiEid()).toBe(ai);
    expect(sb.getHits()).toEqual(['harvest_tree']);
    expect(sb.score).toBe(1);
    expect(sb.isComplete()).toBe(true);
  });

  it('ignores hits from a non-AI player', () => {
    const world = createTestWorld();
    // The "AI" is the first player added before the snapshot, so it ends up
    // in playersBefore. The harvester (added after snapshot) is the "real AI"
    // — but we explicitly want to test that a player NOT matching aiEid is
    // ignored. So we let the snapshot include both pre-existing and harvester
    // and add NO new player after — meaning aiEid never resolves and no hits
    // can be recorded.
    addTestPlayer(world, 30, 30);
    const { entityId: harvester } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(harvester, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(harvester)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(harvester, axe.itemId);
    placeTree(world, 11, 10);

    const playersBefore = new Set(world.players.keys()); // includes harvester

    const sb = new Scoreboard(world, checkpoints, playersBefore);
    sb.attach();

    world.setAction(harvester, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(200);

    expect(sb.getAiEid()).toBe(null);
    expect(sb.getHits()).toEqual([]);
  });

  it('ignores broadcast channel events (only counts first-person emit)', () => {
    // A bystander placed after snapshot becomes the "AI". A separate player
    // (in the snapshot) does the harvesting; the AI receives broadcast events
    // but never the emit, so no hit fires.
    const world = createTestWorld();
    const { entityId: harvester } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(harvester, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(harvester)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(harvester, axe.itemId);
    placeTree(world, 11, 10);

    const playersBefore = new Set(world.players.keys()); // includes harvester
    addTestPlayer(world, 12, 10); // "AI" — bystander, joined after snapshot

    const sb = new Scoreboard(world, checkpoints, playersBefore);
    sb.attach();

    world.setAction(harvester, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(200);

    // AI saw broadcasts only; no emit channel events for this eid.
    expect(sb.getHits()).toEqual([]);
  });
});
