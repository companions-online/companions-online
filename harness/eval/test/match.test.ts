import { describe, it, expect } from 'vitest';
import { matches } from '../match.js';
import { EventPriority, type GameEvent } from '../../../server/src/events.js';

function ev<T extends GameEvent['type']>(type: T, details: Extract<GameEvent, { type: T }>['details']): GameEvent {
  return { type, details, priority: EventPriority.High, tick: 0, timestamp: 0 } as GameEvent;
}

describe('matches', () => {
  it('matches by event type alone when no `match` clause', () => {
    const e = ev('harvest_yield', { harvesterEntityId: 1, blueprintId: 7, resourceName: 'Wood' });
    expect(matches({ id: 'h', event: 'harvest_yield' }, e)).toBe(true);
    expect(matches({ id: 'h', event: 'craft_complete' }, e)).toBe(false);
  });

  it('matches a single field on `details`', () => {
    const wood = ev('harvest_yield', { harvesterEntityId: 1, blueprintId: 7, resourceName: 'Wood' });
    const stone = ev('harvest_yield', { harvesterEntityId: 1, blueprintId: 8, resourceName: 'Stone' });
    const cp = { id: 'h', event: 'harvest_yield' as const, match: { resourceName: 'Wood' } };
    expect(matches(cp, wood)).toBe(true);
    expect(matches(cp, stone)).toBe(false);
  });

  it('requires all match keys to satisfy', () => {
    const e = ev('craft_complete', { crafterEntityId: 1, blueprintId: 9, itemName: 'Axe', quantity: 1 });
    expect(matches({ id: 'a', event: 'craft_complete', match: { itemName: 'Axe', quantity: 1 } }, e)).toBe(true);
    expect(matches({ id: 'a', event: 'craft_complete', match: { itemName: 'Axe', quantity: 2 } }, e)).toBe(false);
  });
});
