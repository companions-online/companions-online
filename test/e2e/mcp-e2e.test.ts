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
    expect(tools.tools.length).toBe(19);

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
});
