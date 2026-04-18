import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND, EQUIP_SLOT_BODY, EQUIP_SLOT_HEAD } from '@shared/inventory.js';
import { getBlueprint } from '@shared/blueprints.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameWorld } from './game-world.js';
import { dispatchServerCommand } from './server-commands.js';
import {
  formatEnvelope, ResponseShape,
  formatInventory, formatRecipes, formatContainer, formatEvents,
} from './mcp-formatters.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

const SLOT_MAP: Record<string, number> = { hand: EQUIP_SLOT_HAND, body: EQUIP_SLOT_BODY, head: EQUIP_SLOT_HEAD };

export function registerTools(server: McpServer, conn: McpConnection, world: GameWorld): void {

  async function doAction(action: Record<string, unknown>, summary: string, shape: ResponseShape) {
    world.setAction(conn.entityId, action as any);
    const result = await conn.awaitAction();
    const statusPrefix = result.status === 'complete' ? '' : `[${result.status}] `;
    return text(formatEnvelope(conn, `${statusPrefix}${summary}`, shape));
  }

  // --- Action tools ---

  server.tool('move_to', 'Move to a tile. Blocks until arrival.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => doAction({ action: ClientAction.MoveTo, tileX: x, tileY: y }, `Move to (${x},${y})`, ResponseShape.Full),
  );

  server.tool('attack', 'Attack an entity. Blocks until target or player dies.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => doAction({ action: ClientAction.Attack, entityId: entity_id }, `Attack #${entity_id}`, ResponseShape.Full),
  );

  server.tool('harvest',
    'Harvest a resource tile (tree/rock/water). Harvests up to the server cap or until the target is depleted / inventory full.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => {
      const pre = world.entities.position.get(conn.entityId);
      world.setAction(conn.entityId, { action: ClientAction.Harvest, tileX: x, tileY: y });
      const result = await conn.awaitAction();
      const post = world.entities.position.get(conn.entityId);
      const moved = !pre || !post || pre.tileX !== post.tileX || pre.tileY !== post.tileY;
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      return text(formatEnvelope(conn, `${prefix}Harvest at (${x},${y})`, moved ? ResponseShape.FullInv : ResponseShape.SelfInv));
    },
  );

  server.tool('pickup', 'Pick up a ground item. Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => {
      const pre = world.entities.position.get(conn.entityId);
      world.setAction(conn.entityId, { action: ClientAction.Pickup, entityId: entity_id });
      const result = await conn.awaitAction();
      const post = world.entities.position.get(conn.entityId);
      const moved = !pre || !post || pre.tileX !== post.tileX || pre.tileY !== post.tileY;
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      return text(formatEnvelope(conn, `${prefix}Pickup #${entity_id}`, moved ? ResponseShape.FullInv : ResponseShape.SelfInv));
    },
  );

  server.tool('interact', 'Interact with an entity (door, chest, NPC). Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => {
      const preDialogue = conn.dialogueState;
      const preContainer = conn.containerEntityId;
      world.setAction(conn.entityId, { action: ClientAction.Interact, entityId: entity_id });
      const result = await conn.awaitAction();
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      let shape: ResponseShape;
      if (conn.dialogueState && conn.dialogueState !== preDialogue) shape = ResponseShape.Dialogue;
      else if (conn.containerEntityId !== null && conn.containerEntityId !== preContainer) shape = ResponseShape.Container;
      else shape = ResponseShape.Full;
      return text(formatEnvelope(conn, `${prefix}Interact #${entity_id}`, shape));
    },
  );

  server.tool('use_consumable', 'Use a consumable item (bandage, food). Blocks until healing finishes.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.UseConsumable, itemId: item_id }, `Use consumable #${item_id}`, ResponseShape.SelfInv),
  );

  server.tool('equip', 'Equip an inventory item.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Equip, itemId: item_id }, `Equip #${item_id}`, ResponseShape.SelfInv),
  );

  server.tool('unequip', 'Unequip an item from a slot.',
    { slot: z.enum(['hand', 'body', 'head']) },
    async ({ slot }) => doAction({ action: ClientAction.Unequip, slot: SLOT_MAP[slot] }, `Unequip ${slot}`, ResponseShape.SelfInv),
  );

  server.tool('drop', 'Drop an inventory item on the ground.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Drop, itemId: item_id }, `Drop #${item_id}`, ResponseShape.SelfInv),
  );

  server.tool('craft', 'Craft a recipe by ID. Use get_recipes to see available recipes.',
    { recipe_id: z.number().int() },
    async ({ recipe_id }) => doAction({ action: ClientAction.Craft, recipeId: recipe_id }, `Craft recipe ${recipe_id}`, ResponseShape.SelfInv),
  );

  server.tool('use_item_at', 'Use equipped item at a tile (cook at campfire, place building).',
    { item_id: z.number().int(), x: z.number().int(), y: z.number().int() },
    async ({ item_id, x, y }) => {
      const inv = world.inventoryMgr.get(conn.entityId);
      const item = inv?.items.find(i => i.itemId === item_id);
      const bp = item ? getBlueprint(item.blueprintId) : undefined;
      const shape: ResponseShape = bp?.category === 'placeable' ? ResponseShape.Full : ResponseShape.SelfInv;
      return doAction(
        { action: ClientAction.UseItemAt, itemId: item_id, tileX: x, tileY: y },
        `Use item #${item_id} at (${x},${y})`, shape,
      );
    },
  );

  server.tool('transfer', 'Transfer item to/from a container. Must interact with container first.',
    { item_id: z.number().int(), container_id: z.number().int(), direction: z.enum(['to', 'from']) },
    async ({ item_id, container_id, direction }) => doAction(
      { action: ClientAction.Transfer, itemId: item_id, containerId: container_id, direction: direction === 'to' ? 0 : 1 },
      `Transfer #${item_id} ${direction} container #${container_id}`,
      ResponseShape.Transfer,
    ),
  );

  server.tool('dialogue_select', 'Select a dialogue option when talking to an NPC.',
    { npc_entity_id: z.number().int(), option_id: z.number().int() },
    async ({ npc_entity_id, option_id }) => doAction(
      { action: ClientAction.DialogueSelect, npcEntityId: npc_entity_id, optionId: option_id },
      `Dialogue option ${option_id}`, ResponseShape.Dialogue,
    ),
  );

  server.tool('trade', 'Execute a trade with an NPC by trade ID.',
    { npc_entity_id: z.number().int(), trade_id: z.number().int() },
    async ({ npc_entity_id, trade_id }) => doAction(
      { action: ClientAction.Trade, npcEntityId: npc_entity_id, tradeId: trade_id },
      `Trade ${trade_id}`, ResponseShape.SelfInv,
    ),
  );

  server.tool('say', 'Send a chat message to nearby players.',
    { message: z.string().max(200) },
    async ({ message }) => doAction({ action: ClientAction.Say, message }, `Say: "${message}"`, ResponseShape.Social),
  );

  server.tool('server_command',
    'Run a server command. Available: nick/name <displayName>.',
    { command: z.string(), parameter: z.string() },
    async ({ command, parameter }) => {
      const slot = world.players.get(conn.entityId);
      if (!slot) return text('[error] no active player slot');
      const result = dispatchServerCommand(world, conn.entityId, slot, command, parameter);
      const summary = result.ok
        ? `/${command} ${parameter}`
        : `[error] ${result.error}`;
      return text(formatEnvelope(conn, summary, ResponseShape.Meta));
    },
  );

  // --- Query tools ---

  server.tool('get_surroundings', 'Look around. Returns status, ASCII map, nearby entities, terrain, and events.',
    async () => text(formatEnvelope(conn, null, ResponseShape.Full)),
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
