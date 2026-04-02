import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND, EQUIP_SLOT_BODY, EQUIP_SLOT_HEAD } from '@shared/inventory.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameWorld } from './game-world.js';
import {
  formatActionResponse, formatSurroundings,
  formatInventory, formatRecipes, formatContainer, formatEvents,
} from './mcp-formatters.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

const SLOT_MAP: Record<string, number> = { hand: EQUIP_SLOT_HAND, body: EQUIP_SLOT_BODY, head: EQUIP_SLOT_HEAD };

export function registerTools(server: McpServer, conn: McpConnection, world: GameWorld): void {

  async function doAction(action: Record<string, unknown>, summary: string) {
    world.setAction(conn.entityId, action as any);
    const result = await conn.awaitAction();
    const statusPrefix = result.status === 'complete' ? '' : `[${result.status}] `;
    return text(formatActionResponse(conn, `${statusPrefix}${summary}`));
  }

  // --- Action tools ---

  server.tool('move_to', 'Move to a tile. Blocks until arrival.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => doAction({ action: ClientAction.MoveTo, tileX: x, tileY: y }, `Move to (${x},${y})`),
  );

  server.tool('attack', 'Attack an entity. Blocks until target or player dies.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => doAction({ action: ClientAction.Attack, entityId: entity_id }, `Attack #${entity_id}`),
  );

  server.tool('harvest', 'Harvest a resource tile (tree/rock/water). Blocks until depleted or inventory full.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => doAction({ action: ClientAction.Harvest, tileX: x, tileY: y }, `Harvest at (${x},${y})`),
  );

  server.tool('pickup', 'Pick up a ground item. Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => doAction({ action: ClientAction.Pickup, entityId: entity_id }, `Pickup #${entity_id}`),
  );

  server.tool('interact', 'Interact with an entity (door, chest, NPC). Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => doAction({ action: ClientAction.Interact, entityId: entity_id }, `Interact #${entity_id}`),
  );

  server.tool('use_consumable', 'Use a consumable item (bandage, food). Blocks until healing finishes.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.UseConsumable, itemId: item_id }, `Use consumable #${item_id}`),
  );

  server.tool('equip', 'Equip an inventory item.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Equip, itemId: item_id }, `Equip #${item_id}`),
  );

  server.tool('unequip', 'Unequip an item from a slot.',
    { slot: z.enum(['hand', 'body', 'head']) },
    async ({ slot }) => doAction({ action: ClientAction.Unequip, slot: SLOT_MAP[slot] }, `Unequip ${slot}`),
  );

  server.tool('drop', 'Drop an inventory item on the ground.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Drop, itemId: item_id }, `Drop #${item_id}`),
  );

  server.tool('craft', 'Craft a recipe by ID. Use get_recipes to see available recipes.',
    { recipe_id: z.number().int() },
    async ({ recipe_id }) => doAction({ action: ClientAction.Craft, recipeId: recipe_id }, `Craft recipe ${recipe_id}`),
  );

  server.tool('use_item_at', 'Use equipped item at a tile (cook at campfire, place building).',
    { item_id: z.number().int(), x: z.number().int(), y: z.number().int() },
    async ({ item_id, x, y }) => doAction({ action: ClientAction.UseItemAt, itemId: item_id, tileX: x, tileY: y }, `Use item #${item_id} at (${x},${y})`),
  );

  server.tool('transfer', 'Transfer item to/from a container. Must interact with container first.',
    { item_id: z.number().int(), container_id: z.number().int(), direction: z.enum(['to', 'from']) },
    async ({ item_id, container_id, direction }) => doAction(
      { action: ClientAction.Transfer, itemId: item_id, containerId: container_id, direction: direction === 'to' ? 0 : 1 },
      `Transfer #${item_id} ${direction} container #${container_id}`,
    ),
  );

  server.tool('dialogue_select', 'Select a dialogue option when talking to an NPC.',
    { npc_entity_id: z.number().int(), option_id: z.number().int() },
    async ({ npc_entity_id, option_id }) => doAction({ action: ClientAction.DialogueSelect, npcEntityId: npc_entity_id, optionId: option_id }, `Dialogue option ${option_id}`),
  );

  server.tool('trade', 'Execute a trade with an NPC by trade ID.',
    { npc_entity_id: z.number().int(), trade_id: z.number().int() },
    async ({ npc_entity_id, trade_id }) => doAction({ action: ClientAction.Trade, npcEntityId: npc_entity_id, tradeId: trade_id }, `Trade ${trade_id}`),
  );

  server.tool('say', 'Send a chat message to nearby players.',
    { message: z.string().max(200) },
    async ({ message }) => doAction({ action: ClientAction.Say, message }, `Say: "${message}"`),
  );

  // --- Query tools ---

  server.tool('get_surroundings', 'Look around. Returns status, ASCII map, nearby entities, terrain, and events.',
    async () => text(formatSurroundings(conn)),
  );

  server.tool('get_inventory', 'View inventory with item IDs, equipment slots, and weight.',
    async () => text(formatInventory(conn) + '\n\n' + formatEvents(conn)),
  );

  server.tool('get_recipes', 'List craftable recipes (only those you have materials for).',
    async () => text(formatRecipes(conn) + '\n\n' + formatEvents(conn)),
  );

  server.tool('get_container', 'View contents of the last opened container.',
    async () => text(formatContainer(conn) + '\n\n' + formatEvents(conn)),
  );
}
