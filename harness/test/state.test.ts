import { describe, it, expect } from 'vitest';
import { createCompactState, recordTurn, isPerception } from '../compact.js';

describe('compact state', () => {
  it('classifies results with <map> as perceptions', () => {
    expect(isPerception('hello <map> world')).toBe(true);
    expect(isPerception('no map')).toBe(false);
  });

  it('rolls action window and routes perceptions vs actions', () => {
    const s = createCompactState({ systemPrompt: '', firstMessage: '', actionWindowSize: 3 });
    for (let i = 1; i <= 5; i++) {
      recordTurn(s, {
        step: i, inlineText: '', tool: `t${i}`, args: { i },
        result: i % 2 === 0 ? `<map>n${i}` : `plain ${i}`,
      });
    }
    expect(s.actionWindow.map(e => e.step)).toEqual([3, 4, 5]);
    expect(s.lastPerception?.tool).toBe('t4');
  });

  it('perception slot updates on each perception turn', () => {
    const s = createCompactState({ systemPrompt: '', firstMessage: '' });
    recordTurn(s, { step: 1, inlineText: '', tool: 'look', args: {}, result: '<map>A' });
    expect(s.lastPerception?.result).toBe('<map>A');
    recordTurn(s, { step: 2, inlineText: '', tool: 'look', args: {}, result: '<map>B' });
    expect(s.lastPerception?.result).toBe('<map>B');
  });

  it('harness-kind turns do not update lastPerception; still go into window', () => {
    const s = createCompactState({ systemPrompt: '', firstMessage: '' });
    recordTurn(s, { step: 1, inlineText: '', tool: 'look', args: {}, result: '<map>A' });
    recordTurn(s, { step: 2, inlineText: '', tool: 'memory_update', args: {}, result: '<map>fake' }, { kind: 'harness' });
    expect(s.lastPerception?.result).toBe('<map>A');
    expect(s.actionWindow.map(e => e.tool)).toEqual(['look', 'memory_update']);
  });
});
