/**
 * Reasons an action can be rejected before it takes effect.
 *
 * Structured codes kept internally so tests + non-MCP consumers can branch on
 * them; `formatRejection` renders them to LLM-readable text at the MCP boundary
 * (mirrors the GameEvent / formatEventText split in mcp-formatters.ts).
 *
 * Grow the union as new rejection sites appear — no catch-all "other" variant.
 */
export type RejectionReason =
  | { code: 'tile_blocked'; tileX: number; tileY: number; by: 'wall' | 'door' | 'water' | 'rock' | 'entity' }
  | { code: 'tile_out_of_bounds'; tileX: number; tileY: number }
  | { code: 'no_path'; tileX: number; tileY: number }
  | { code: 'not_adjacent'; targetEntityId: number; dist: number }
  | { code: 'target_missing'; targetEntityId: number }
  | { code: 'wrong_target_kind'; targetEntityId: number; expected: string; got: string }
  | { code: 'inventory_full'; weight: number; maxWeight: number }
  | { code: 'item_missing'; itemId: number }
  | { code: 'slot_empty'; slot: 'hand' | 'body' | 'head' | 'boot' }
  | { code: 'not_equippable'; itemId: number }
  | { code: 'recipe_unknown'; recipeId: number }
  | { code: 'missing_materials'; recipeId: number }
  | { code: 'container_closed' }
  | { code: 'dialogue_closed' }
  | { code: 'dialogue_option_invalid'; optionId: number }
  | { code: 'trade_unavailable'; tradeId: number }
  | { code: 'not_harvestable'; tileX: number; tileY: number }
  | { code: 'not_consumable'; itemId: number }
  | { code: 'not_placeable'; itemId: number }
  | { code: 'dead' };

export function formatRejection(r: RejectionReason): string {
  switch (r.code) {
    case 'tile_blocked':
      return `tile (${r.tileX},${r.tileY}) blocked by ${r.by}`;
    case 'tile_out_of_bounds':
      return `tile (${r.tileX},${r.tileY}) out of bounds`;
    case 'no_path':
      return `no path to (${r.tileX},${r.tileY})`;
    case 'not_adjacent':
      return `#${r.targetEntityId} is ${r.dist} tiles away — move adjacent first`;
    case 'target_missing':
      return `#${r.targetEntityId} no longer exists`;
    case 'wrong_target_kind':
      return `#${r.targetEntityId} is a ${r.got}, expected ${r.expected}`;
    case 'inventory_full':
      return `inventory full (${r.weight}/${r.maxWeight})`;
    case 'item_missing':
      return `no item #${r.itemId} in inventory`;
    case 'slot_empty':
      return `${r.slot} slot is empty`;
    case 'not_equippable':
      return `item #${r.itemId} is not equippable`;
    case 'recipe_unknown':
      return `unknown recipe ${r.recipeId}`;
    case 'missing_materials':
      return `missing materials for recipe ${r.recipeId}`;
    case 'container_closed':
      return `no container is open — interact with a chest first`;
    case 'dialogue_closed':
      return `no dialogue is open — interact with an NPC first`;
    case 'dialogue_option_invalid':
      return `dialogue option ${r.optionId} is not available`;
    case 'trade_unavailable':
      return `trade ${r.tradeId} is not available`;
    case 'not_harvestable':
      return `nothing harvestable at (${r.tileX},${r.tileY}) — check terrain or equip the right tool`;
    case 'not_consumable':
      return `item #${r.itemId} is not consumable`;
    case 'not_placeable':
      return `item #${r.itemId} is not placeable`;
    case 'dead':
      return `you are dead`;
  }
}
