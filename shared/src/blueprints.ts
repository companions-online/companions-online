export interface Blueprint {
  id: number;
  name: string;
  sprite: string;
  maxHp: number;
  speed: number;        // tiles per second
  damage: number;       // base damage per hit
  attackSpeed: number;  // ticks between attacks
  collides: boolean;
}

export const enum BlueprintType {
  Player = 0,
  Deer   = 1,
  Rabbit = 2,
  Fox    = 3,
  Wolf   = 4,
  Tree   = 10,
  Rock   = 11,
}

const BLUEPRINTS: Blueprint[] = [
  { id: BlueprintType.Player, name: 'Player', sprite: 'player', maxHp: 100, speed: 3,   damage: 5,  attackSpeed: 20, collides: true },
  { id: BlueprintType.Deer,   name: 'Deer',   sprite: 'deer',   maxHp: 30,  speed: 3.5, damage: 0,  attackSpeed: 0,  collides: true },
  { id: BlueprintType.Rabbit, name: 'Rabbit', sprite: 'rabbit', maxHp: 10,  speed: 4,   damage: 0,  attackSpeed: 0,  collides: true },
  { id: BlueprintType.Fox,    name: 'Fox',    sprite: 'fox',    maxHp: 25,  speed: 3,   damage: 8,  attackSpeed: 15, collides: true },
  { id: BlueprintType.Wolf,   name: 'Wolf',   sprite: 'wolf',   maxHp: 50,  speed: 2.5, damage: 15, attackSpeed: 20, collides: true },
  { id: BlueprintType.Tree,   name: 'Tree',   sprite: 'tree',   maxHp: 50,  speed: 0,   damage: 0,  attackSpeed: 0,  collides: true },
  { id: BlueprintType.Rock,   name: 'Rock',   sprite: 'rock',   maxHp: 80,  speed: 0,   damage: 0,  attackSpeed: 0,  collides: true },
];

const blueprintMap = new Map<number, Blueprint>();
for (const bp of BLUEPRINTS) {
  blueprintMap.set(bp.id, bp);
}

export function getBlueprint(id: number): Blueprint | undefined {
  return blueprintMap.get(id);
}
