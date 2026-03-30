import { BlueprintType } from './blueprints.js';

export interface Recipe {
  id: number;
  output: { blueprintId: number; quantity: number };
  inputs: { blueprintId: number; quantity: number }[];
  requiresTool?: number;
}

const RECIPES: Recipe[] = [
  // Tools
  { id: 0,  output: { blueprintId: BlueprintType.Axe, quantity: 1 },        inputs: [{ blueprintId: BlueprintType.Wood, quantity: 2 }, { blueprintId: BlueprintType.Rock, quantity: 1 }] },
  { id: 1,  output: { blueprintId: BlueprintType.Pickaxe, quantity: 1 },    inputs: [{ blueprintId: BlueprintType.Wood, quantity: 2 }, { blueprintId: BlueprintType.Rock, quantity: 2 }] },
  { id: 2,  output: { blueprintId: BlueprintType.Hammer, quantity: 1 },     inputs: [{ blueprintId: BlueprintType.Wood, quantity: 1 }, { blueprintId: BlueprintType.Iron, quantity: 2 }] },
  { id: 3,  output: { blueprintId: BlueprintType.FishingRod, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Wood, quantity: 2 }, { blueprintId: BlueprintType.Hide, quantity: 1 }] },

  // Weapons
  { id: 4,  output: { blueprintId: BlueprintType.WoodenClub, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Wood, quantity: 3 }] },
  { id: 5,  output: { blueprintId: BlueprintType.StoneKnife, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Wood, quantity: 1 }, { blueprintId: BlueprintType.Rock, quantity: 2 }] },
  { id: 6,  output: { blueprintId: BlueprintType.IronSword, quantity: 1 },  inputs: [{ blueprintId: BlueprintType.Wood, quantity: 1 }, { blueprintId: BlueprintType.Iron, quantity: 3 }], requiresTool: BlueprintType.Hammer },
  { id: 7,  output: { blueprintId: BlueprintType.IronSpear, quantity: 1 },  inputs: [{ blueprintId: BlueprintType.Wood, quantity: 2 }, { blueprintId: BlueprintType.Iron, quantity: 2 }], requiresTool: BlueprintType.Hammer },

  // Armor
  { id: 8,  output: { blueprintId: BlueprintType.HideVest, quantity: 1 },       inputs: [{ blueprintId: BlueprintType.Hide, quantity: 4 }] },
  { id: 9,  output: { blueprintId: BlueprintType.HideCap, quantity: 1 },        inputs: [{ blueprintId: BlueprintType.Hide, quantity: 2 }] },
  { id: 10, output: { blueprintId: BlueprintType.IronChestplate, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Iron, quantity: 5 }], requiresTool: BlueprintType.Hammer },
  { id: 11, output: { blueprintId: BlueprintType.IronHelm, quantity: 1 },       inputs: [{ blueprintId: BlueprintType.Iron, quantity: 3 }], requiresTool: BlueprintType.Hammer },

  // Consumables
  { id: 12, output: { blueprintId: BlueprintType.Bandage, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Hide, quantity: 2 }] },

  // Placeables
  { id: 13, output: { blueprintId: BlueprintType.Campfire, quantity: 1 },     inputs: [{ blueprintId: BlueprintType.Wood, quantity: 3 }, { blueprintId: BlueprintType.Rock, quantity: 1 }] },
  { id: 14, output: { blueprintId: BlueprintType.WoodenWall, quantity: 1 },   inputs: [{ blueprintId: BlueprintType.Wood, quantity: 4 }] },
  { id: 15, output: { blueprintId: BlueprintType.WoodenDoor, quantity: 1 },   inputs: [{ blueprintId: BlueprintType.Wood, quantity: 5 }, { blueprintId: BlueprintType.Iron, quantity: 1 }] },
  { id: 16, output: { blueprintId: BlueprintType.StorageChest, quantity: 1 }, inputs: [{ blueprintId: BlueprintType.Wood, quantity: 6 }, { blueprintId: BlueprintType.Iron, quantity: 2 }] },
];

const recipeMap = new Map<number, Recipe>();
for (const r of RECIPES) {
  recipeMap.set(r.id, r);
}

export function getRecipe(id: number): Recipe | undefined {
  return recipeMap.get(id);
}

export function getAllRecipes(): readonly Recipe[] {
  return RECIPES;
}
