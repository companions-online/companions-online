import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND, EQUIP_SLOT_BODY, EQUIP_SLOT_HEAD } from '@shared/inventory.js';
import { getBlueprint } from '@shared/blueprints.js';
import { MetaKey } from '@shared/entity-meta.js';
import type { McpConnection } from './connections/mcp-connection.js';
import type { GameWorld } from './game-world.js';
import { dispatchServerCommand, validateName } from './server-commands.js';
import { setSessionEntity } from './mcp-session.js';
import {
  formatEnvelope, ResponseShape,
  formatInventory, formatRecipes, formatContainer, formatEvents,
} from './mcp-formatters.js';
import { formatRejection } from './action-rejection.js';

function text(t: string, opts?: { isError?: boolean }) {
  const result: { content: { type: 'text'; text: string }[]; isError?: boolean } = {
    content: [{ type: 'text' as const, text: t }],
  };
  if (opts?.isError) result.isError = true;
  return result;
}

const NOT_IDENTIFIED = text(
  '[error] not identified — call identify(name) first',
  { isError: true },
);

const SLOT_MAP: Record<string, number> = { hand: EQUIP_SLOT_HAND, body: EQUIP_SLOT_BODY, head: EQUIP_SLOT_HEAD };

export function registerTools(server: McpServer, conn: McpConnection, world: GameWorld): void {

  // Wraps a tool handler with the identify guard. Anything registered via this
  // helper returns NOT_IDENTIFIED when conn.entityId === 0.
  function guarded<A extends Record<string, any>>(
    name: string,
    description: string,
    schema: any,
    handler: (args: A) => Promise<ReturnType<typeof text>> | ReturnType<typeof text>,
  ) {
    server.tool(name, description, schema, async (args: A) => {
      if (conn.entityId === 0) return NOT_IDENTIFIED;
      return handler(args);
    });
  }

  async function doAction(action: Record<string, unknown>, summary: string, shape: ResponseShape) {
    world.setAction(conn.entityId, action as any);
    const result = await conn.awaitAction();
    if (result.status === 'rejected') {
      return text(
        formatEnvelope(conn, `[rejected: ${formatRejection(result.reason)}] ${summary}`, shape),
        { isError: true },
      );
    }
    const statusPrefix = result.status === 'complete' ? '' : `[${result.status}] `;
    return text(formatEnvelope(conn, `${statusPrefix}${summary}`, shape));
  }

  // --- Identify (only tool that skips the guard) ---

  server.tool('identify',
    'Register your player. Must be called before any other tool. Takes a display name (1-16 chars; letters, digits, underscore, or hyphen).',
    { name: z.string() },
    async ({ name }) => {
      if (conn.entityId !== 0) {
        const existing = world.getEntityMeta(conn.entityId, MetaKey.Name) ?? 'unknown';
        return text(
          `[error] already identified as "${existing}"; use server_command(nick, <newName>) to rename`,
          { isError: true },
        );
      }
      const check = validateName(name);
      if (!check.ok) return text(`[error] ${check.error}`, { isError: true });

      const entityId = world.addPlayer(conn);
      world.setEntityMeta(entityId, MetaKey.Name, check.name);
      if (conn.sessionId) setSessionEntity(conn.sessionId, entityId);
      conn.entityId = entityId;

      return text(formatEnvelope(conn, `Identified as ${check.name}`, ResponseShape.Full));
    },
  );

  // --- Action tools ---

  guarded('move_to', 'Move to a tile. Blocks until arrival.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => doAction({ action: ClientAction.MoveTo, tileX: x, tileY: y }, `Move to (${x},${y})`, ResponseShape.Full),
  );

  guarded('attack', 'Attack an entity. Blocks until target or player dies.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => doAction({ action: ClientAction.Attack, entityId: entity_id }, `Attack #${entity_id}`, ResponseShape.Full),
  );

  guarded('harvest',
    'Harvest a resource tile (tree/rock/water). Harvests up to the server cap or until the target is depleted / inventory full.',
    { x: z.number().int(), y: z.number().int() },
    async ({ x, y }) => {
      const pre = world.entities.position.get(conn.entityId);
      world.setAction(conn.entityId, { action: ClientAction.Harvest, tileX: x, tileY: y });
      const result = await conn.awaitAction();
      const post = world.entities.position.get(conn.entityId);
      const moved = !pre || !post || pre.tileX !== post.tileX || pre.tileY !== post.tileY;
      const shape = moved ? ResponseShape.FullInv : ResponseShape.SelfInv;
      if (result.status === 'rejected') {
        return text(
          formatEnvelope(conn, `[rejected: ${formatRejection(result.reason)}] Harvest at (${x},${y})`, shape),
          { isError: true },
        );
      }
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      return text(formatEnvelope(conn, `${prefix}Harvest at (${x},${y})`, shape));
    },
  );

  guarded('pickup', 'Pick up a ground item. Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => {
      const pre = world.entities.position.get(conn.entityId);
      world.setAction(conn.entityId, { action: ClientAction.Pickup, entityId: entity_id });
      const result = await conn.awaitAction();
      const post = world.entities.position.get(conn.entityId);
      const moved = !pre || !post || pre.tileX !== post.tileX || pre.tileY !== post.tileY;
      const shape = moved ? ResponseShape.FullInv : ResponseShape.SelfInv;
      if (result.status === 'rejected') {
        return text(
          formatEnvelope(conn, `[rejected: ${formatRejection(result.reason)}] Pickup #${entity_id}`, shape),
          { isError: true },
        );
      }
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      return text(formatEnvelope(conn, `${prefix}Pickup #${entity_id}`, shape));
    },
  );

  guarded('interact', 'Interact with an entity (door, chest, NPC). Auto-pathfinds if not adjacent.',
    { entity_id: z.number().int() },
    async ({ entity_id }) => {
      const preDialogue = conn.dialogueState;
      const preContainer = conn.containerEntityId;
      world.setAction(conn.entityId, { action: ClientAction.Interact, entityId: entity_id });
      const result = await conn.awaitAction();
      let shape: ResponseShape;
      if (conn.dialogueState && conn.dialogueState !== preDialogue) shape = ResponseShape.Dialogue;
      else if (conn.containerEntityId !== null && conn.containerEntityId !== preContainer) shape = ResponseShape.Container;
      else shape = ResponseShape.Full;
      if (result.status === 'rejected') {
        return text(
          formatEnvelope(conn, `[rejected: ${formatRejection(result.reason)}] Interact #${entity_id}`, shape),
          { isError: true },
        );
      }
      const prefix = result.status === 'complete' ? '' : `[${result.status}] `;
      return text(formatEnvelope(conn, `${prefix}Interact #${entity_id}`, shape));
    },
  );

  guarded('use_consumable', 'Use a consumable item (bandage, food). Blocks until healing finishes.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.UseConsumable, itemId: item_id }, `Use consumable #${item_id}`, ResponseShape.SelfInv),
  );

  guarded('equip', 'Equip an inventory item.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Equip, itemId: item_id }, `Equip #${item_id}`, ResponseShape.SelfInv),
  );

  guarded('unequip', 'Unequip an item from a slot.',
    { slot: z.enum(['hand', 'body', 'head']) },
    async ({ slot }) => doAction({ action: ClientAction.Unequip, slot: SLOT_MAP[slot] }, `Unequip ${slot}`, ResponseShape.SelfInv),
  );

  guarded('drop', 'Drop an inventory item on the ground.',
    { item_id: z.number().int() },
    async ({ item_id }) => doAction({ action: ClientAction.Drop, itemId: item_id }, `Drop #${item_id}`, ResponseShape.SelfInv),
  );

  guarded('craft', 'Craft a recipe by ID. Use get_recipes to see available recipes.',
    { recipe_id: z.number().int() },
    async ({ recipe_id }) => doAction({ action: ClientAction.Craft, recipeId: recipe_id }, `Craft recipe ${recipe_id}`, ResponseShape.SelfInv),
  );

  guarded('use_item_at', 'Use equipped item at a tile (cook at campfire, place building).',
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

  guarded('transfer', 'Transfer item to/from a container. Must interact with container first.',
    { item_id: z.number().int(), container_id: z.number().int(), direction: z.enum(['to', 'from']) },
    async ({ item_id, container_id, direction }) => doAction(
      { action: ClientAction.Transfer, itemId: item_id, containerId: container_id, direction: direction === 'to' ? 0 : 1 },
      `Transfer #${item_id} ${direction} container #${container_id}`,
      ResponseShape.Transfer,
    ),
  );

  guarded('dialogue_select', 'Select a dialogue option when talking to an NPC.',
    { npc_entity_id: z.number().int(), option_id: z.number().int() },
    async ({ npc_entity_id, option_id }) => doAction(
      { action: ClientAction.DialogueSelect, npcEntityId: npc_entity_id, optionId: option_id },
      `Dialogue option ${option_id}`, ResponseShape.Dialogue,
    ),
  );

  guarded('trade', 'Execute a trade with an NPC by trade ID.',
    { npc_entity_id: z.number().int(), trade_id: z.number().int() },
    async ({ npc_entity_id, trade_id }) => doAction(
      { action: ClientAction.Trade, npcEntityId: npc_entity_id, tradeId: trade_id },
      `Trade ${trade_id}`, ResponseShape.SelfInv,
    ),
  );

  guarded('say', 'Send a chat message to nearby players.',
    { message: z.string().max(200) },
    async ({ message }) => doAction({ action: ClientAction.Say, message }, `Say: "${message}"`, ResponseShape.Social),
  );

  guarded('server_command',
    'Run a server command. Available: nick/name <displayName>.',
    { command: z.string(), parameter: z.string() },
    async ({ command, parameter }) => {
      const slot = world.players.get(conn.entityId)!;
      const result = dispatchServerCommand(world, conn.entityId, slot, command, parameter);
      if (!result.ok) {
        return text(`[error] ${result.error}`, { isError: true });
      }
      return text(formatEnvelope(conn, `/${command} ${parameter}`, ResponseShape.Meta));
    },
  );

  // --- Query tools ---

  guarded('get_surroundings', 'Look around. Returns status, ASCII map, nearby entities, terrain, and events.',
    {},
    async () => text(formatEnvelope(conn, null, ResponseShape.Full)),
  );

  guarded('get_inventory', 'View inventory with item IDs, equipment slots, and weight.',
    {},
    async () => text(formatInventory(conn) + '\n\n' + formatEvents(conn)),
  );

  guarded('get_recipes', 'List craftable recipes (only those you have materials for).',
    {},
    async () => text(formatRecipes(conn) + '\n\n' + formatEvents(conn)),
  );

  guarded('get_container', 'View contents of the last opened container.',
    {},
    async () => text(formatContainer(conn) + '\n\n' + formatEvents(conn)),
  );
}
