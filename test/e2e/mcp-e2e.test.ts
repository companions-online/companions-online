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

let world: GameWorld;
let server: Server;
let loop: GameLoop;
let baseUrl: string;

async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
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

    expect(toolNames).toContain('move_to');
    expect(toolNames).toContain('attack');
    expect(toolNames).toContain('harvest');
    expect(toolNames).toContain('get_surroundings');
    expect(toolNames).toContain('get_inventory');
    expect(toolNames).toContain('craft');
    expect(toolNames).toContain('server_command');
    expect(tools.tools.length).toBe(20);

    await client.close();
  });

  it('get_surroundings returns formatted world state with all sections', async () => {
    const client = await createMcpClient();
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
    const client = await createMcpClient();
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
    const client = await createMcpClient();
    const result = await client.callTool({ name: 'get_recipes', arguments: {} });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<recipes>');
    expect(text).toContain('</recipes>');
    // Player starts with 2 Wood + 1 Rock → can craft Axe (recipe 0)
    expect(text).toContain('Axe');

    await client.close();
  });

  it('craft tool returns with craft result + events', async () => {
    const client = await createMcpClient();

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
    const client = await createMcpClient();

    const result = await client.callTool({ name: 'say', arguments: { message: 'hello world' } });

    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('<action');
    expect(text).toContain('hello world');

    await client.close();
  });

  it('server_command sets player name and surfaces it in <self>', async () => {
    const client = await createMcpClient();

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
    const client = await createMcpClient();

    const result = await client.callTool({
      name: 'server_command',
      arguments: { command: 'nick', parameter: 'has space' },
    });
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('[error]');

    await client.close();
  });

  it('say returns social shape: events only, no <map> or <entities>', async () => {
    const client = await createMcpClient();

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
    const client = await createMcpClient();

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
    world.entities.statusEffects.set(chestEid, { effects: 0 });
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
    const client = await createMcpClient();

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
});
