import { describe, it, expect } from 'vitest';
import {
  EventBuffer,
  EventPriority,
  EVENT_PRIORITY,
  type GameEvent,
  type GameEventType,
} from '../server/src/events.js';

function makeEvent(
  type: GameEventType,
  tick: number,
  overrides?: { timestamp?: number; priority?: EventPriority },
): GameEvent {
  return {
    type,
    priority: overrides?.priority ?? EVENT_PRIORITY[type],
    tick,
    timestamp: overrides?.timestamp ?? Date.now(),
    details: {},
  } as GameEvent;
}

// --- Basic operations ---

describe('EventBuffer', () => {
  describe('basic operations', () => {
    it('starts empty', () => {
      const buf = new EventBuffer();
      expect(buf.length).toBe(0);
    });

    it('push adds events and length reflects count', () => {
      const buf = new EventBuffer();
      buf.push(makeEvent('harvest_yield', 1));
      buf.push(makeEvent('craft_complete', 2));
      expect(buf.length).toBe(2);
    });

    it('flush returns all events and clears buffer', () => {
      const buf = new EventBuffer();
      buf.push(makeEvent('harvest_yield', 1));
      buf.push(makeEvent('combat_hit_received', 2));
      const events = buf.flush();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('harvest_yield');
      expect(events[1].type).toBe('combat_hit_received');
      expect(buf.length).toBe(0);
    });

    it('flush on empty buffer returns empty array', () => {
      const buf = new EventBuffer();
      expect(buf.flush()).toEqual([]);
    });

    it('peek returns events without consuming them', () => {
      const buf = new EventBuffer();
      buf.push(makeEvent('player_say', 1));
      const peeked = buf.peek();
      expect(peeked).toHaveLength(1);
      expect(buf.length).toBe(1);
    });
  });

  // --- Max size enforcement ---

  describe('max size enforcement', () => {
    it('evicts when buffer reaches maxSize on push', () => {
      const buf = new EventBuffer(3);
      buf.push(makeEvent('harvest_yield', 1));   // High
      buf.push(makeEvent('harvest_yield', 2));   // High
      buf.push(makeEvent('harvest_yield', 3));   // High
      buf.push(makeEvent('harvest_yield', 4));   // High — triggers eviction
      expect(buf.length).toBe(3);
      // Oldest High (tick=1) should be evicted
      const events = buf.flush();
      expect(events.map(e => e.tick)).toEqual([2, 3, 4]);
    });

    it('critical overflow: buffer grows beyond maxSize if all critical', () => {
      const buf = new EventBuffer(2);
      buf.push(makeEvent('combat_hit_received', 1));
      buf.push(makeEvent('player_say', 2));
      buf.push(makeEvent('player_died', 3));
      // All 3 are Critical — no eviction possible, buffer exceeds maxSize
      expect(buf.length).toBe(3);
    });
  });

  // --- Priority-based decay ---

  describe('priority-based decay', () => {
    it('Medium evicted before High', () => {
      const buf = new EventBuffer(2);
      buf.push(makeEvent('creature_fleeing', 1));  // Medium
      buf.push(makeEvent('harvest_yield', 2));     // High
      buf.push(makeEvent('craft_complete', 3));    // High — evicts Medium
      expect(buf.length).toBe(2);
      const events = buf.flush();
      expect(events.map(e => e.type)).toEqual(['harvest_yield', 'craft_complete']);
    });

    it('High evicted before Critical', () => {
      const buf = new EventBuffer(2);
      buf.push(makeEvent('combat_hit_received', 1));  // Critical
      buf.push(makeEvent('harvest_yield', 2));         // High
      buf.push(makeEvent('player_say', 3));            // Critical — evicts High
      expect(buf.length).toBe(2);
      const events = buf.flush();
      expect(events.map(e => e.type)).toEqual(['combat_hit_received', 'player_say']);
    });

    it('Critical events are never evicted by decay', () => {
      const buf = new EventBuffer(3);
      buf.push(makeEvent('combat_hit_received', 1));
      buf.push(makeEvent('player_say', 2));
      buf.push(makeEvent('entity_died', 3));
      // All critical, buffer full — push another critical
      buf.push(makeEvent('player_died', 4));
      // Buffer should have all 4 (overflow allowed)
      expect(buf.length).toBe(4);
      const events = buf.flush();
      expect(events.map(e => e.tick)).toEqual([1, 2, 3, 4]);
    });

    it('within same priority tier, oldest event is evicted first', () => {
      const buf = new EventBuffer(3);
      buf.push(makeEvent('harvest_yield', 1));   // High
      buf.push(makeEvent('craft_complete', 2));  // High
      buf.push(makeEvent('item_picked_up', 3));  // High
      buf.push(makeEvent('trade_complete', 4));  // High — evicts tick=1
      const events = buf.flush();
      expect(events.map(e => e.tick)).toEqual([2, 3, 4]);
    });

    it('mixed priorities: correct eviction order', () => {
      const buf = new EventBuffer(4);
      buf.push(makeEvent('creature_died', 1));       // Medium
      buf.push(makeEvent('creature_fleeing', 2));     // Medium
      buf.push(makeEvent('harvest_yield', 3));        // High
      buf.push(makeEvent('combat_hit_received', 4));  // Critical

      // Push another — should evict oldest Medium (tick=1)
      buf.push(makeEvent('item_picked_up', 5));
      expect(buf.length).toBe(4);
      let events = buf.peek();
      expect(events.map(e => e.tick)).toEqual([2, 3, 4, 5]);

      // Push another — should evict remaining Medium (tick=2)
      buf.push(makeEvent('craft_complete', 6));
      expect(buf.length).toBe(4);
      events = buf.peek();
      expect(events.map(e => e.tick)).toEqual([3, 4, 5, 6]);

      // Push another — should evict oldest High (tick=3)
      buf.push(makeEvent('building_placed', 7));
      expect(buf.length).toBe(4);
      events = buf.peek();
      expect(events.map(e => e.tick)).toEqual([4, 5, 6, 7]);
    });
  });

  // --- Age-out ---

  describe('age-out', () => {
    it('push removes events older than maxAge', () => {
      const buf = new EventBuffer(50, 100); // 100ms maxAge
      buf.push(makeEvent('harvest_yield', 1, { timestamp: Date.now() - 200 }));
      buf.push(makeEvent('craft_complete', 2));
      // The old event should have been aged out during push
      expect(buf.length).toBe(1);
      expect(buf.peek()[0].tick).toBe(2);
    });

    it('flush removes events older than maxAge', () => {
      const buf = new EventBuffer(50, 100);
      buf.push(makeEvent('harvest_yield', 1, { timestamp: Date.now() - 200 }));
      const events = buf.flush();
      expect(events).toHaveLength(0);
    });

    it('critical events age out too', () => {
      const buf = new EventBuffer(50, 100);
      buf.push(makeEvent('combat_hit_received', 1, { timestamp: Date.now() - 200 }));
      buf.push(makeEvent('player_say', 2, { timestamp: Date.now() - 200 }));
      const events = buf.flush();
      expect(events).toHaveLength(0);
    });

    it('events exactly at maxAge boundary are removed', () => {
      const now = Date.now();
      const buf = new EventBuffer(50, 100);
      // timestamp === cutoff means timestamp is NOT > cutoff, so it's removed
      buf.push(makeEvent('harvest_yield', 1, { timestamp: now - 100 }));
      buf.push(makeEvent('harvest_yield', 2, { timestamp: now }));
      const events = buf.flush();
      expect(events).toHaveLength(1);
      expect(events[0].tick).toBe(2);
    });
  });

  // --- Integration ---

  describe('integration', () => {
    it('full scenario: mixed priorities, overflow, and age-out', () => {
      const buf = new EventBuffer(3, 500);
      const now = Date.now();

      // Fill with mixed priorities
      buf.push(makeEvent('creature_fleeing', 1, { timestamp: now }));      // Medium
      buf.push(makeEvent('combat_hit_dealt', 2, { timestamp: now }));      // High
      buf.push(makeEvent('combat_hit_received', 3, { timestamp: now }));   // Critical

      // Push High — evicts Medium (tick=1)
      buf.push(makeEvent('harvest_yield', 4, { timestamp: now }));
      expect(buf.length).toBe(3);

      // Push Critical — evicts oldest High (tick=2)
      buf.push(makeEvent('player_say', 5, { timestamp: now }));
      expect(buf.length).toBe(3);

      // Push Critical — evicts remaining High (tick=4)
      buf.push(makeEvent('entity_died', 6, { timestamp: now }));
      expect(buf.length).toBe(3);

      // Push Critical — all are Critical now, overflow allowed
      buf.push(makeEvent('action_interrupted', 7, { timestamp: now }));
      expect(buf.length).toBe(4);

      // Now add an old event that should get aged out
      buf.push(makeEvent('player_died', 8, { timestamp: now - 600 }));
      // The old event gets pushed then aged out on next operation
      // Actually it's added then on next push/flush it ages out
      // Let's flush to trigger age-out
      const events = buf.flush();
      // tick=8 is aged out, ticks 3,5,6,7 remain
      expect(events.map(e => e.tick)).toEqual([3, 5, 6, 7]);
    });
  });
});

// --- EVENT_PRIORITY map ---

describe('EVENT_PRIORITY', () => {
  it('maps all 19 event types', () => {
    const types: GameEventType[] = [
      'combat_hit_received', 'entity_died', 'player_died', 'player_respawned',
      'player_say', 'action_interrupted', 'creature_aggro',
      'combat_hit_dealt', 'harvest_yield', 'resource_depleted', 'item_picked_up',
      'craft_complete', 'trade_complete', 'item_cooked', 'consume_complete', 'building_placed',
      'creature_fleeing', 'creature_died', 'entity_meta_changed',
    ];
    for (const t of types) {
      expect(EVENT_PRIORITY[t]).toBeDefined();
    }
    expect(Object.keys(EVENT_PRIORITY)).toHaveLength(19);
  });

  it('critical types are priority 0', () => {
    const criticals: GameEventType[] = [
      'combat_hit_received', 'entity_died', 'player_died', 'player_respawned',
      'player_say', 'action_interrupted', 'creature_aggro',
    ];
    for (const t of criticals) {
      expect(EVENT_PRIORITY[t]).toBe(EventPriority.Critical);
    }
  });

  it('high types are priority 1', () => {
    const highs: GameEventType[] = [
      'combat_hit_dealt', 'harvest_yield', 'resource_depleted', 'item_picked_up',
      'craft_complete', 'trade_complete', 'item_cooked', 'consume_complete', 'building_placed',
    ];
    for (const t of highs) {
      expect(EVENT_PRIORITY[t]).toBe(EventPriority.High);
    }
  });

  it('medium types are priority 2', () => {
    const mediums: GameEventType[] = ['creature_fleeing', 'creature_died'];
    for (const t of mediums) {
      expect(EVENT_PRIORITY[t]).toBe(EventPriority.Medium);
    }
  });
});
