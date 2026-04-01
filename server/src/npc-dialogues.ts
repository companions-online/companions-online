import { BlueprintType } from '@shared/blueprints.js';

export interface TradeOffer {
  tradeId: number;
  givesBlueprint: number;
  givesQty: number;
  wantsBlueprint: number;
  wantsQty: number;
}

export interface DialogueOption {
  optionId: number;
  label: string;
  type: 'talk' | 'trade';
  response?: string;
  trades?: TradeOffer[];
}

export interface NPCDialogue {
  greeting: string;
  options: DialogueOption[];
}

const HERMIT_DIALOGUE: NPCDialogue = {
  greeting: 'Ah, another soul washed ashore. Take these — you\'ll need them.',
  options: [
    {
      optionId: 1,
      label: 'Tell me about this place',
      type: 'talk',
      response: 'This island holds many secrets. Trees for wood, hills for rock and iron. Beware the wolves and skeletons — they don\'t take kindly to strangers.',
    },
    {
      optionId: 2,
      label: 'I need supplies',
      type: 'trade',
      trades: [
        { tradeId: 1, givesBlueprint: BlueprintType.Wood, givesQty: 2, wantsBlueprint: 0, wantsQty: 0 },
        { tradeId: 2, givesBlueprint: BlueprintType.Rock, givesQty: 1, wantsBlueprint: 0, wantsQty: 0 },
      ],
    },
  ],
};

const TRADER_DIALOGUE: NPCDialogue = {
  greeting: 'Buyin\' or sellin\'?',
  options: [
    {
      optionId: 1,
      label: 'Show me your wares',
      type: 'trade',
      trades: [
        { tradeId: 1, givesBlueprint: BlueprintType.Bandage, givesQty: 1, wantsBlueprint: BlueprintType.Hide, wantsQty: 3 },
        { tradeId: 2, givesBlueprint: BlueprintType.Iron, givesQty: 1, wantsBlueprint: BlueprintType.Rock, wantsQty: 5 },
        { tradeId: 3, givesBlueprint: BlueprintType.Hide, givesQty: 1, wantsBlueprint: BlueprintType.Wood, wantsQty: 3 },
        { tradeId: 4, givesBlueprint: BlueprintType.StoneKnife, givesQty: 1, wantsBlueprint: BlueprintType.Iron, wantsQty: 2 },
      ],
    },
  ],
};

const WANDERER_DIALOGUE: NPCDialogue = {
  greeting: 'You\'ve come far. I have something for those who prove their worth.',
  options: [
    {
      optionId: 1,
      label: 'What do you want?',
      type: 'trade',
      trades: [
        { tradeId: 1, givesBlueprint: BlueprintType.Compass, givesQty: 1, wantsBlueprint: BlueprintType.Iron, wantsQty: 10 },
      ],
    },
    {
      optionId: 2,
      label: 'Where are you headed?',
      type: 'talk',
      response: 'Always moving, never staying. The richest iron veins lie near the rocky peaks. Look for the darkest stone.',
    },
  ],
};

const DIALOGUES = new Map<number, NPCDialogue>([
  [BlueprintType.Hermit, HERMIT_DIALOGUE],
  [BlueprintType.Trader, TRADER_DIALOGUE],
  [BlueprintType.Wanderer, WANDERER_DIALOGUE],
]);

export function getDialogue(blueprintId: number): NPCDialogue | undefined {
  return DIALOGUES.get(blueprintId);
}
