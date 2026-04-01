import { BlueprintType } from './blueprints.js';

export interface LootDrop {
  blueprintId: number;
  quantity: number;
  chance?: number; // 0-1, default 1.0 (guaranteed)
}

const LOOT_TABLES: Partial<Record<number, LootDrop[]>> = {
  [BlueprintType.Rabbit]:   [],
  [BlueprintType.Deer]:     [{ blueprintId: BlueprintType.Hide, quantity: 2 }, { blueprintId: BlueprintType.RawMeat, quantity: 1 }],
  [BlueprintType.Fox]:      [{ blueprintId: BlueprintType.Hide, quantity: 1 }],
  [BlueprintType.Wolf]:     [{ blueprintId: BlueprintType.Hide, quantity: 2 }, { blueprintId: BlueprintType.RawMeat, quantity: 1 }],
  [BlueprintType.Bear]:     [{ blueprintId: BlueprintType.Hide, quantity: 3 }, { blueprintId: BlueprintType.RawMeat, quantity: 2 }],
  [BlueprintType.Skeleton]: [{ blueprintId: BlueprintType.Iron, quantity: 1, chance: 0.5 }, { blueprintId: BlueprintType.Iron, quantity: 1 }, { blueprintId: BlueprintType.Rock, quantity: 1 }],
};

export function getLootTable(blueprintId: number): LootDrop[] {
  return LOOT_TABLES[blueprintId] ?? [];
}
