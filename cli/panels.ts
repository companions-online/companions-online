import { getBlueprint } from '../shared/src/blueprints.js';
import { getAllRecipes } from '../shared/src/recipes.js';
import { canCraft, numberToEquipSlot, MAX_PLAYER_WEIGHT } from '../shared/src/inventory.js';
import { state, getBpId } from './state.js';

export function renderInventoryLine(vy: number, totalRows: number, maxW: number): string {
  if (vy === 0) return '\x1b[1mINVENTORY\x1b[0m';
  if (vy === 1) return '';

  const itemIdx = vy - 2;
  if (itemIdx >= 0 && itemIdx < state.inventory.length) {
    const item = state.inventory[itemIdx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    let slotPrefix = '    ';
    if (item.equippedSlot === 1) slotPrefix = '[H] ';
    else if (item.equippedSlot === 2) slotPrefix = '[B] ';
    else if (item.equippedSlot === 3) slotPrefix = '[^] ';

    const consumeHint = bp?.consumeHeal ? ` +${bp.consumeHeal}hp` : '';
    const selected = itemIdx === state.invCursor;
    const text = `${selected ? '>' : ' '} ${slotPrefix}${name}${qty}${consumeHint}`;
    return selected ? `\x1b[7m${text}\x1b[0m` : text;
  }

  const footerStart = Math.max(state.inventory.length + 3, totalRows - 3);
  if (vy === footerStart) {
    const wt = state.inventory.reduce((s, i) => s + (getBlueprint(i.blueprintId)?.weight ?? 0) * i.quantity, 0);
    return `Weight: ${wt}/${MAX_PLAYER_WEIGHT}`;
  }
  return '';
}

export function renderCraftingLine(vy: number, totalRows: number, maxW: number): string {
  if (vy === 0) return '\x1b[1mCRAFTING\x1b[0m';
  if (vy === 1) return '';

  const recipes = getAllRecipes();
  const inv = {
    items: state.inventory.map(i => ({
      itemId: i.itemId,
      blueprintId: i.blueprintId,
      quantity: i.quantity,
      equippedSlot: numberToEquipSlot(i.equippedSlot),
    })),
    maxWeight: MAX_PLAYER_WEIGHT,
  };

  const recipeIdx = vy - 2;
  if (recipeIdx >= 0 && recipeIdx < recipes.length) {
    const recipe = recipes[recipeIdx];
    const outBp = getBlueprint(recipe.output.blueprintId);
    const outName = outBp?.name ?? '?';
    const inputs = recipe.inputs.map(inp => {
      const ibp = getBlueprint(inp.blueprintId);
      return `${inp.quantity} ${ibp?.name ?? '?'}`;
    }).join(', ');
    const craftable = canCraft(recipe, inv);
    const selected = recipeIdx === state.invCursor;
    const prefix = selected ? '>' : ' ';
    const text = `${prefix} ${outName} (${inputs})`;
    if (!craftable) return `\x1b[90m${text}\x1b[0m`;
    return selected ? `\x1b[7m${text}\x1b[0m` : text;
  }
  return '';
}

export function renderContainerLine(vy: number, _totalRows: number, _maxW: number): string {
  const chestHeader = 0;
  const chestStart = 1;
  const chestEnd = chestStart + state.containerItems.length;
  const sep = chestEnd + 1;
  const invHeader = sep + 1;
  const invStart = invHeader + 1;

  if (vy === chestHeader) return '\x1b[1mCHEST\x1b[0m';
  if (vy >= chestStart && vy < chestEnd) {
    const idx = vy - chestStart;
    const item = state.containerItems[idx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const sel = state.containerSide === 'chest' && idx === state.containerCursor;
    const text = `${sel ? '>' : ' '} ${name}${qty}`;
    return sel ? `\x1b[7m${text}\x1b[0m` : text;
  }
  if (vy === sep) return '\x1b[90m────────────────────\x1b[0m';
  if (vy === invHeader) return '\x1b[1mYOUR INVENTORY\x1b[0m';
  const invIdx = vy - invStart;
  if (invIdx >= 0 && invIdx < state.inventory.length) {
    const item = state.inventory[invIdx];
    const bp = getBlueprint(item.blueprintId);
    const name = bp?.name ?? `#${item.blueprintId}`;
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const sel = state.containerSide === 'player' && invIdx === state.containerCursor;
    const text = `${sel ? '>' : ' '} ${name}${qty}`;
    return sel ? `\x1b[7m${text}\x1b[0m` : text;
  }
  return '';
}

export function renderDialogueLine(vy: number, _totalRows: number, _maxW: number): string {
  if (!state.dialogueData) return '';
  if (vy === 0) {
    const npcComp = state.entityMap.get(state.dialogueNpcId);
    const id = getBpId(npcComp?.blueprint);
    const name = id !== undefined ? getBlueprint(id)?.name ?? 'NPC' : 'NPC';
    return `\x1b[1m${name}\x1b[0m`;
  }
  if (vy === 1) return `"${state.dialogueData.greeting}"`;
  if (vy === 2) return '';

  const optIdx = vy - 3;
  if (optIdx >= 0 && optIdx < state.dialogueData.options.length) {
    const opt = state.dialogueData.options[optIdx];
    if (opt.trades && opt.trades.length > 0) {
      const lines: string[] = [];
      for (const t of opt.trades) {
        const giveBp = getBlueprint(t.givesBlueprint);
        const wantBp = getBlueprint(t.wantsBlueprint);
        if (t.wantsBlueprint === 0) {
          lines.push(`  [${t.tradeId}] FREE: ${t.givesQty} ${giveBp?.name ?? '?'}`);
        } else {
          lines.push(`  [${t.tradeId}] ${t.wantsQty} ${wantBp?.name ?? '?'} -> ${t.givesQty} ${giveBp?.name ?? '?'}`);
        }
      }
      if (optIdx === 0) return `[${opt.optionId}] ${opt.label}`;
      return lines[optIdx - 1] ?? '';
    }
    return `[${opt.optionId}] ${opt.label}`;
  }

  // Show trade offers if the first option has trades (trade view)
  if (state.dialogueData.options.length === 1 && state.dialogueData.options[0].trades) {
    const trades = state.dialogueData.options[0].trades;
    const tradeIdx = vy - 3 - 1;
    if (tradeIdx >= 0 && tradeIdx < trades.length) {
      const t = trades[tradeIdx];
      const giveBp = getBlueprint(t.givesBlueprint);
      const wantBp = getBlueprint(t.wantsBlueprint);
      if (t.wantsBlueprint === 0) {
        return ` [${t.tradeId}] FREE: ${t.givesQty} ${giveBp?.name ?? '?'}`;
      }
      return ` [${t.tradeId}] ${t.wantsQty} ${wantBp?.name ?? '?'} -> ${t.givesQty} ${giveBp?.name ?? '?'}`;
    }
  }

  return '';
}
