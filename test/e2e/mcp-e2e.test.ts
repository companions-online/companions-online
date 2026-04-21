import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { GameWorld, createDefaultWorld } from '../../server/src/game-world.js';
import { GameLoop } from '../../server/src/ecs/game-loop.js';
import { Telemetry } from '../../server/src/telemetry.js';
import { createApp } from '../../server/src/app.js';
import { TICK_RATE } from '../../shared/src/constants.js';
import { destroySession } from '../../server/src/mcp-session.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import { StatusEffect } from '../../shared/src/status-effects.js';

let world: GameWorld;
let server: Server;
let loop: GameLoop;
let baseUrl: string;
let clientSeq = 0;

async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** Connect + identify with a unique name so tests don't collide on the same player. */
async function createIdentifiedMcpClient(name?: string): Promise<Client> {
  const client = await createMcpClient();
  const finalName = name ?? `t${++clientSeq}`;
  await client.callTool({ name: 'identify', arguments: { name: finalName } });
  return client;
}

beforeAll(async () => {
  world = createDefaultWorld(42);
  const telemetry = new Telemetry();
  (world as any).telemetry = telemetry;

  const { app } = createApp(world, telemetry);

  loop = new GameLoop(TICK_RATE);
  loop.start(() => { world.runTick(); });

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    }) as Server;
  });
});

afterAll(async () => {
  loop.stop();
  server?.close();
});

describe('MCP E2E', () => {
  it('initialize creates session and returns tool list', async () => {
    const client = await createMcpClient();
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);

    expect(toolNames).toContain('identify');
    expect(toolNames).toContain('move_to');
    expect(toolNames).toContain('attack');
    expect(toolNames).toContain('harvest');
    expect(toolNames).toContain('get_surroundings');
    expect(toolNames).toContain('get_inventory');
    expect(toolNames).toContain('craft');
    expect(toolNames).toContain('server_command');
    expect(tools.tools.length).toBe(21);

    await client.close();
  });

  it('tools reject before identify', async () => {
    const client = await createMcpClient();
    const result = await client.callTool({ name: 'get_surroundings', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('[error]');
    expect(text).toContain('identify');

    await client.close();
  });

  it('identify spawns player and returns Full envelope with name', async () => {
    const client = await createMcpClient();
    const result = await client.callTool({ name: 'identify', arguments: { name: 'alice' } });

    expect(result.isError).toBeFalsy();
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<action');
    expect(text).toContain('Identified as alice');
    expect(text).toContain('<self>');
    expect(text).toMatch(/name:"alice"/);
    expect(text).toContain('<map>');
    expect(text).toContain('<entities>');

    await client.close();
  });

  it('double identify returns error pointing to server_command', async () => {
    const client = await createMcpClient();
    await client.callTool({ name: 'identify', arguments: { name: 'first' } });
    const result = await client.callTool({ name: 'identify', arguments: { name: 'second' } });

    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('[error]');
    expect(text).toContain('already identified');
    expect(text).toContain('server_command');

    await client.close();
  });

  it('identify rejects invalid names', async () => {
    const cases = [
      { arg: '', reason: 'characters' },
      { arg: 'has space', reason: 'letters' },
      { arg: '!', reason: 'letters' },
      { arg: 'a'.repeat(17), reason: 'characters' },
    ];
    for (const { arg, reason } of cases) {
      const client = await createMcpClient();
      const result = await client.callTool({ name: 'identify', arguments: { name: arg } });
      expect(result.isError).toBe(true);
      const text = (result.content as any[])[0].text as string;
      expect(text).toContain('[error]');
      expect(text).toMatch(new RegExp(reason));
      await client.close();
    }
  });

  it('get_surroundings returns formatted world state with all sections', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({ name: 'get_surroundings', arguments: {} });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<self>');
    expect(text).toContain('</self>');
    expect(text).toContain('<map>');
    expect(text).toContain('</map>');
    expect(text).toContain('<entities>');
    expect(text).toContain('</entities>');
    expect(text).toContain('<terrain>');
    expect(text).toContain('</terrain>');
    expect(text).toContain('<events>');
    expect(text).toContain('</events>');
    // Self section should have position and hp
    expect(text).toMatch(/pos:\(\d+,\d+\)/);
    expect(text).toMatch(/hp:\d+\/\d+/);
    // Map should have @ for player
    expect(text).toContain('@');

    await client.close();
  });

  it('get_inventory returns player inventory with item IDs', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({ name: 'get_inventory', arguments: {} });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<inventory>');
    expect(text).toContain('</inventory>');
    expect(text).toContain('[hand]');
    expect(text).toContain('[body]');
    expect(text).toContain('[head]');
    expect(text).toContain('total:');
    // Player starts with 2 Wood + 1 Rock
    expect(text).toContain('Wood');
    expect(text).toContain('Rock');

    await client.close();
  });

  it('get_recipes returns craftable recipes', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({ name: 'get_recipes', arguments: {} });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<recipes>');
    expect(text).toContain('</recipes>');
    // Player starts with 2 Wood + 1 Rock → can craft Axe (recipe 0)
    expect(text).toContain('Axe');

    await client.close();
  });

  it('craft tool returns with craft result + events', async () => {
    const client = await createIdentifiedMcpClient();

    // Craft axe (recipe 0: 2 Wood + 1 Rock)
    const result = await client.callTool({ name: 'craft', arguments: { recipe_id: 0 } });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<action');
    expect(text).toContain('Craft recipe 0');
    expect(text).toContain('<self>');
    // Events should include craft_complete
    expect(text).toContain('Crafted Axe');

    await client.close();
  });

  it('say tool returns immediately', async () => {
    const client = await createIdentifiedMcpClient();

    const result = await client.callTool({ name: 'say', arguments: { message: 'hello world' } });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<action');
    expect(text).toContain('hello world');

    await client.close();
  });

  it('server_command sets player name and surfaces it in <self>', async () => {
    const client = await createIdentifiedMcpClient('placeholder');

    const setResult = await client.callTool({
      name: 'server_command',
      arguments: { command: 'nick', parameter: 'mcpbot' },
    });
    const setText = (setResult.content as any[])[0].text as string;
    expect(setText).toContain('/nick mcpbot');

    const surroundings = await client.callTool({ name: 'get_surroundings', arguments: {} });
    const selfText = (surroundings.content as any[])[0].text as string;
    expect(selfText).toMatch(/name:"mcpbot"/);

    await client.close();
  });

  it('server_command rejects invalid nicks with an error prefix', async () => {
    const client = await createIdentifiedMcpClient();

    const result = await client.callTool({
      name: 'server_command',
      arguments: { command: 'nick', parameter: 'has space' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('[error]');

    await client.close();
  });

  it('say returns social shape: events only, no <map> or <entities>', async () => {
    const client = await createIdentifiedMcpClient();

    const result = await client.callTool({ name: 'say', arguments: { message: 'ping' } });
    const text = (result.content as any[])[0].text as string;

    expect(text).toContain('<action');
    expect(text).toContain('<events>');
    expect(text).not.toContain('<map>');
    expect(text).not.toContain('<entities>');
    expect(text).not.toContain('<terrain>');
    expect(text).not.toContain('<self>');

    await client.close();
  });

  it('interact on adjacent chest returns container shape, not map', async () => {
    const client = await createIdentifiedMcpClient();

    // Find this client's player (most-recently-added — only one active session at a time here).
    const playerIds = [...world.players.keys()];
    const playerId = playerIds[playerIds.length - 1];
    const pos = world.entities.position.get(playerId)!;

    // Place a StorageChest on the tile east of the player.
    const chestX = pos.tileX + 1;
    const chestY = pos.tileY;
    // If something's there, clear it so the chest has a clean tile.
    const existing = world.occupancy.get(chestX, chestY);
    if (existing) {
      world.occupancy.clear(chestX, chestY);
      world.entities.destroy(existing);
    }
    const chestEid = world.entities.create();
    world.entities.position.set(chestEid, { tileX: chestX, tileY: chestY });
    world.entities.blueprint.set(chestEid, { blueprintId: BlueprintType.StorageChest, variant: 0 });
    world.entities.statusEffects.set(chestEid, { effects: StatusEffect.Placed });
    world.entities.health.set(chestEid, { currentHp: 50, maxHp: 50 });
    world.occupancy.set(chestX, chestY, chestEid);
    world.inventoryMgr.create(chestEid, 100);

    const result = await client.callTool({ name: 'interact', arguments: { entity_id: chestEid } });
    const text = (result.content as any[])[0].text as string;

    expect(text).toContain('<action');
    expect(text).toContain('<self>');
    expect(text).toContain('<container');
    expect(text).toContain(`#${chestEid}`);
    expect(text).toContain('<events>');
    expect(text).not.toContain('<map>');
    expect(text).not.toContain('<entities>');

    await client.close();
  });

  it('equip returns self_inv shape: self + inventory + events, no map', async () => {
    const client = await createIdentifiedMcpClient();

    // Player starts with 2 Wood + 1 Rock + an Axe recipe could craft, but default
    // inventory has no equippable tool. Simplest path: inject an Axe via world state.
    const playerIds = [...world.players.keys()];
    const playerId = playerIds[playerIds.length - 1];
    const res = world.inventoryMgr.addItem(playerId, BlueprintType.Axe, 1);
    expect(res.success).toBe(true);
    const inv = world.inventoryMgr.get(playerId)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;

    const result = await client.callTool({ name: 'equip', arguments: { item_id: axe.itemId } });
    const text = (result.content as any[])[0].text as string;

    expect(text).toContain('<action');
    expect(text).toContain('<self>');
    expect(text).toContain('<inventory>');
    expect(text).toContain('<events>');
    expect(text).not.toContain('<map>');
    expect(text).not.toContain('<entities>');
    expect(text).toContain('hand:Axe');

    await client.close();
  });

  it('move_to unwalkable tile rejects with reason', async () => {
    const client = await createIdentifiedMcpClient();
    const playerIds = [...world.players.keys()];
    const playerId = playerIds[playerIds.length - 1];
    const pos = world.entities.position.get(playerId)!;

    // Force a wall east of the player so the reason is deterministic.
    const wallX = pos.tileX + 1;
    const wallY = pos.tileY;
    const existing = world.occupancy.get(wallX, wallY);
    if (existing) { world.occupancy.clear(wallX, wallY); world.entities.destroy(existing); }
    world.map.setBuilding(wallX, wallY, 1 /* Building.Wall */);

    const result = await client.callTool({ name: 'move_to', arguments: { x: wallX, y: wallY } });

    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('[rejected:');
    expect(text).toContain(`tile (${wallX},${wallY})`);
    expect(text).toContain('blocked by wall');
    // Envelope still shows current state so the LLM can recover.
    expect(text).toContain('<self>');
    expect(text).toContain('<map>');

    world.map.setBuilding(wallX, wallY, 0 /* Building.None */);
    await client.close();
  });

  it('move_to out-of-bounds rejects', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({ name: 'move_to', arguments: { x: -5, y: 50 } });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('out of bounds');
    await client.close();
  });

  it('pickup of non-item entity rejects with wrong_target_kind', async () => {
    const client = await createIdentifiedMcpClient();
    const playerIds = [...world.players.keys()];
    const playerId = playerIds[playerIds.length - 1];

    // Target an NPC — Hermit/Trader are npcs so pickup must reject.
    let npcEid: number | undefined;
    for (const eid of world.entities.getAllEntities()) {
      if (eid === playerId) continue;
      const bp = world.entities.blueprint.get(eid);
      if (bp?.blueprintId === BlueprintType.Hermit || bp?.blueprintId === BlueprintType.Trader) {
        npcEid = eid; break;
      }
    }
    expect(npcEid).toBeDefined();

    const result = await client.callTool({ name: 'pickup', arguments: { entity_id: npcEid! } });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('expected ground item');
    await client.close();
  });

  it('craft with unknown recipe rejects', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({ name: 'craft', arguments: { recipe_id: 9999 } });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('unknown recipe 9999');
    await client.close();
  });

  it('transfer without a chest rejects with target_missing', async () => {
    const client = await createIdentifiedMcpClient();
    const result = await client.callTool({
      name: 'transfer',
      arguments: { item_id: 1, container_id: 999999, direction: 'to' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('no longer exists');
    await client.close();
  });

  it('dialogue_select with invalid option rejects', async () => {
    const client = await createIdentifiedMcpClient();
    const playerIds = [...world.players.keys()];
    const playerId = playerIds[playerIds.length - 1];
    const pos = world.entities.position.get(playerId)!;

    // Place a Hermit adjacent so not_adjacent doesn't fire first.
    const npcX = pos.tileX + 1;
    const npcY = pos.tileY;
    const existing = world.occupancy.get(npcX, npcY);
    if (existing) { world.occupancy.clear(npcX, npcY); world.entities.destroy(existing); }
    const npcEid = world.entities.create();
    world.entities.position.set(npcEid, { tileX: npcX, tileY: npcY });
    world.entities.blueprint.set(npcEid, { blueprintId: BlueprintType.Hermit, variant: 0 });

    const result = await client.callTool({
      name: 'dialogue_select',
      arguments: { npc_entity_id: npcEid, option_id: 9999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('dialogue option 9999');

    world.entities.destroy(npcEid);
    await client.close();
  });

  it('identify broadcasts nametag to nearby players', async () => {
    // Two MCP clients; the second identifies after the first is already there.
    // The first should see an entity_meta_changed event for the second.
    const alice = await createIdentifiedMcpClient('alice');

    // Place alice and a second session's player at close coords before B identifies.
    // We can't position alice, but both spawn near SPAWN so they're in range.
    const bob = await createMcpClient();
    await bob.callTool({ name: 'identify', arguments: { name: 'bob' } });

    // Pump a tick so the event emitted on bob's spawn reaches alice's event buffer.
    world.runTick();

    const surround = await alice.callTool({ name: 'get_surroundings', arguments: {} });
    const text = (surround.content as any[])[0].text as string;
    // Either alice saw bob's meta change in events, or bob shows in alice's entities.
    // We accept either: the meta event is the stricter signal.
    const mentionsBob = text.includes('bob') || text.includes('changed name');
    expect(mentionsBob).toBe(true);

    await alice.close();
    await bob.close();
  });
});
