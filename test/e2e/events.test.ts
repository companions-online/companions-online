import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree, placeGroundItem } from './helpers.js';
import { GameWorld } from '../../server/src/game-world.js';
import { HeadlessConnection } from '../../server/src/connections/headless-connection.js';
import { ClientAction } from '../../shared/src/actions.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import { Terrain } from '../../shared/src/terrain.js';
import type { GameEvent, GameEventType } from '../../server/src/events.js';

function eventsOfType(conn: HeadlessConnection, type: GameEventType): GameEvent[] {
  return conn.gameEvents.filter(e => e.type === type);
}

describe('E2E: Game Events', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = createTestWorld();
  });

  // --- Combat ---

  it('attack emits combat_hit_dealt and entity_died on kill', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Spawn a deer adjacent
    const deerEid = world.entities.create();
    world.entities.position.set(deerEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(deerEid, { blueprintId: BlueprintType.Deer, variant: 0 });
    world.entities.health.set(deerEid, { currentHp: 3, maxHp: 12 });
    world.entities.currentAction.set(deerEid, { actionType: 0 });
    world.occupancy.set(11, 10, deerEid);

    world.setAction(entityId, { action: ClientAction.Attack, entityId: deerEid });
    world.runTicks(20);

    const hits = eventsOfType(connection, 'combat_hit_dealt');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect((hits[0].details as any).targetEntityId).toBe(deerEid);
    expect((hits[0].details as any).damage).toBeGreaterThan(0);

    const deaths = eventsOfType(connection, 'entity_died');
    expect(deaths).toHaveLength(1);
    expect((deaths[0].details as any).entityId).toBe(deerEid);
    expect((deaths[0].details as any).drops).toBeDefined();
  });

  it('wolf aggro emits creature_aggro and combat_hit_received', () => {
    // Create wolf with aggro AI
    const wolfEid = world.entities.create();
    world.entities.position.set(wolfEid, { tileX: 13, tileY: 10 });
    world.entities.blueprint.set(wolfEid, { blueprintId: BlueprintType.Wolf, variant: 0 });
    world.entities.health.set(wolfEid, { currentHp: 20, maxHp: 20 });
    world.entities.currentAction.set(wolfEid, { actionType: 0 });
    world.entities.statusEffects.set(wolfEid, { effects: 0 });
    world.entities.speed.set(wolfEid, 4);
    world.occupancy.set(13, 10, wolfEid);
    // Init critter AI for wolf
    world.critterStates.set(wolfEid, { idleTicksRemaining: 0, rng: 42, behavior: 'wander' });

    // Place player within wolf aggro range (5 tiles)
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    world.runTicks(40);

    const aggros = eventsOfType(connection, 'creature_aggro');
    expect(aggros.length).toBeGreaterThanOrEqual(1);
    expect((aggros[0].details as any).creatureEntityId).toBe(wolfEid);

    const hitsReceived = eventsOfType(connection, 'combat_hit_received');
    expect(hitsReceived.length).toBeGreaterThanOrEqual(1);
    expect((hitsReceived[0].details as any).attackerEntityId).toBe(wolfEid);
  });

  // --- Harvest ---

  it('harvest tree emits harvest_yield and resource_depleted', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Give player an axe for faster harvesting
    world.inventoryMgr.addItem(entityId, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const axeItem = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(entityId, axeItem.itemId);

    const treeEid = placeTree(world, 11, 10);

    world.setAction(entityId, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(200);

    const yields = eventsOfType(connection, 'harvest_yield');
    expect(yields.length).toBeGreaterThanOrEqual(1);
    expect((yields[0].details as any).resourceName).toBe('Wood');

    const depleted = eventsOfType(connection, 'resource_depleted');
    expect(depleted).toHaveLength(1);
    expect((depleted[0].details as any).entityId).toBe(treeEid);
  });

  // --- Crafting ---

  it('craft emits craft_complete', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Player starts with 2 wood + 1 rock, can craft axe (2 wood + 1 rock)
    world.setAction(entityId, { action: ClientAction.Craft, recipeId: 0 });
    world.runTicks(1);

    const crafts = eventsOfType(connection, 'craft_complete');
    expect(crafts).toHaveLength(1);
    expect((crafts[0].details as any).blueprintId).toBe(BlueprintType.Axe);
    expect((crafts[0].details as any).itemName).toBe('Axe');
  });

  // --- Pickup ---

  it('pickup emits item_picked_up', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    const groundEid = placeGroundItem(world, BlueprintType.Wood, 11, 10);

    world.setAction(entityId, { action: ClientAction.Pickup, entityId: groundEid });
    world.runTicks(1);

    const pickups = eventsOfType(connection, 'item_picked_up');
    expect(pickups).toHaveLength(1);
    expect((pickups[0].details as any).blueprintId).toBe(BlueprintType.Wood);
    expect((pickups[0].details as any).itemName).toBe('Wood');
  });

  // --- Consumable ---

  it('use bandage emits consume_complete', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Damage player first
    const health = world.entities.health.get(entityId)!;
    health.currentHp = 50;
    world.entities.health.set(entityId, health);

    // Give bandage
    world.inventoryMgr.addItem(entityId, BlueprintType.Bandage, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const bandage = inv.items.find(i => i.blueprintId === BlueprintType.Bandage)!;

    world.setAction(entityId, { action: ClientAction.UseConsumable, itemId: bandage.itemId });
    world.runTicks(20);

    const consumes = eventsOfType(connection, 'consume_complete');
    expect(consumes).toHaveLength(1);
    expect((consumes[0].details as any).itemName).toBe('Bandage');
    expect((consumes[0].details as any).healAmount).toBe(30);
    expect((consumes[0].details as any).currentHp).toBe(80);
  });

  // --- Building ---

  it('place wall emits building_placed', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(entityId, BlueprintType.WoodenWall, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const wall = inv.items.find(i => i.blueprintId === BlueprintType.WoodenWall)!;
    world.inventoryMgr.equip(entityId, wall.itemId);

    world.setAction(entityId, { action: ClientAction.UseItemAt, itemId: wall.itemId, tileX: 11, tileY: 10 });
    world.runTicks(1);

    const placed = eventsOfType(connection, 'building_placed');
    expect(placed).toHaveLength(1);
    expect((placed[0].details as any).blueprintId).toBe(BlueprintType.WoodenWall);
    expect((placed[0].details as any).tileX).toBe(11);
    expect((placed[0].details as any).tileY).toBe(10);
  });

  // --- Cooking ---

  it('cook at campfire emits item_cooked', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Place campfire adjacent
    const campEid = world.entities.create();
    world.entities.position.set(campEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(campEid, { blueprintId: BlueprintType.Campfire, variant: 0 });
    world.entities.statusEffects.set(campEid, { effects: 0 });
    world.occupancy.set(11, 10, campEid);

    world.inventoryMgr.addItem(entityId, BlueprintType.RawFish, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const fish = inv.items.find(i => i.blueprintId === BlueprintType.RawFish)!;
    world.inventoryMgr.equip(entityId, fish.itemId);

    world.setAction(entityId, { action: ClientAction.UseItemAt, itemId: fish.itemId, tileX: 11, tileY: 10 });
    world.runTicks(1);

    const cooked = eventsOfType(connection, 'item_cooked');
    expect(cooked).toHaveLength(1);
    expect((cooked[0].details as any).inputName).toBe('Raw Fish');
    expect((cooked[0].details as any).outputName).toBe('Cooked Fish');
  });

  // --- Death + Respawn ---

  it('player death emits player_died, respawn emits player_respawned', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Kill player by setting HP to 0 via combat
    const wolfEid = world.entities.create();
    world.entities.position.set(wolfEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(wolfEid, { blueprintId: BlueprintType.Wolf, variant: 0 });
    world.entities.health.set(wolfEid, { currentHp: 100, maxHp: 100 });
    world.entities.currentAction.set(wolfEid, { actionType: 0 });
    world.occupancy.set(11, 10, wolfEid);

    // Set player HP low
    world.entities.health.set(entityId, { currentHp: 1, maxHp: 100 });
    // Start wolf combat against player
    world.combatStates.set(wolfEid, { targetEntityId: entityId, ticksRemaining: 0, attackSpeed: 2, damage: 5 });

    world.runTicks(5);

    const deaths = eventsOfType(connection, 'player_died');
    expect(deaths).toHaveLength(1);

    // Run enough ticks for respawn (100 ticks)
    world.runTicks(100);

    const respawns = eventsOfType(connection, 'player_respawned');
    expect(respawns).toHaveLength(1);
    expect((respawns[0].details as any).currentHp).toBe(100);
  });

  // --- Chat ---

  it('say emits player_say for nearby players', () => {
    const p1 = addTestPlayer(world, 10, 10);
    const p2 = addTestPlayer(world, 12, 10);

    world.setAction(p1.entityId, { action: ClientAction.Say, message: 'hello world' });
    world.runTicks(1);

    // p2 should receive the player_say event
    const says = eventsOfType(p2.connection, 'player_say');
    expect(says).toHaveLength(1);
    expect((says[0].details as any).message).toBe('hello world');
    expect((says[0].details as any).senderEntityId).toBe(p1.entityId);
  });

  // --- Interruption ---

  it('new action interrupting harvest emits action_interrupted', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    placeTree(world, 11, 10);

    world.setAction(entityId, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(3);

    // Interrupt with a move
    world.setAction(entityId, { action: ClientAction.MoveTo, tileX: 8, tileY: 10 });
    world.runTicks(1);

    const interrupts = eventsOfType(connection, 'action_interrupted');
    expect(interrupts).toHaveLength(1);
    expect((interrupts[0].details as any).interruptedAction).toBe('harvesting');
    expect((interrupts[0].details as any).reason).toBe('new action');
  });

  // --- Critter behavior ---

  it('creature flees emits creature_fleeing', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Place rabbit with flee behavior nearby
    const rabbitEid = world.entities.create();
    world.entities.position.set(rabbitEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(rabbitEid, { blueprintId: BlueprintType.Rabbit, variant: 0 });
    world.entities.health.set(rabbitEid, { currentHp: 5, maxHp: 5 });
    world.entities.currentAction.set(rabbitEid, { actionType: 0 });
    world.entities.speed.set(rabbitEid, 3);
    world.occupancy.set(11, 10, rabbitEid);
    world.critterStates.set(rabbitEid, { idleTicksRemaining: 0, rng: 42, behavior: 'wander' });

    // Rabbit flee range is 3 — player at distance 1 should trigger flee
    world.runTicks(5);

    const flees = eventsOfType(connection, 'creature_fleeing');
    expect(flees.length).toBeGreaterThanOrEqual(1);
    expect((flees[0].details as any).creatureEntityId).toBe(rabbitEid);
  });

  it('creature killed by another entity emits creature_died to nearby player', () => {
    const { entityId, connection } = addTestPlayer(world, 10, 10);
    // Create two entities: wolf kills deer
    const deerEid = world.entities.create();
    world.entities.position.set(deerEid, { tileX: 12, tileY: 10 });
    world.entities.blueprint.set(deerEid, { blueprintId: BlueprintType.Deer, variant: 0 });
    world.entities.health.set(deerEid, { currentHp: 1, maxHp: 12 });
    world.entities.currentAction.set(deerEid, { actionType: 0 });
    world.occupancy.set(12, 10, deerEid);

    const wolfEid = world.entities.create();
    world.entities.position.set(wolfEid, { tileX: 13, tileY: 10 });
    world.entities.blueprint.set(wolfEid, { blueprintId: BlueprintType.Wolf, variant: 0 });
    world.entities.health.set(wolfEid, { currentHp: 20, maxHp: 20 });
    world.entities.currentAction.set(wolfEid, { actionType: 0 });
    world.occupancy.set(13, 10, wolfEid);

    // Wolf attacks deer
    world.combatStates.set(wolfEid, { targetEntityId: deerEid, ticksRemaining: 0, attackSpeed: 2, damage: 5 });

    world.runTicks(5);

    // Player should get creature_died (not entity_died, since player isn't the killer)
    const creatureDeaths = eventsOfType(connection, 'creature_died');
    expect(creatureDeaths).toHaveLength(1);
    expect((creatureDeaths[0].details as any).entityId).toBe(deerEid);
    expect((creatureDeaths[0].details as any).killerEntityId).toBe(wolfEid);

    // Player should NOT get entity_died
    const entityDeaths = eventsOfType(connection, 'entity_died');
    expect(entityDeaths).toHaveLength(0);
  });
});
