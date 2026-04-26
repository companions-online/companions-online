import { describe, it, expect } from 'vitest';
import { createCompactState, recordTurn, buildMessages, abbreviateResult } from '../compact.js';

describe('compact prompt-builder', () => {
  it('first turn returns system + user(first)', () => {
    const s = createCompactState({ systemPrompt: 'SYS', firstMessage: 'FIRST' });
    const msgs = buildMessages({ state: s, memory: '' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('SYS');
    expect(msgs[0].content).toContain('(empty)');
    expect(msgs[0].content).toContain('(none yet)');
    expect(msgs[0].content).not.toContain('Last perception');
    expect(msgs[0].content).not.toContain('Last action');
    expect(msgs[1]).toEqual({ role: 'user', content: 'FIRST' });
  });

  it('subsequent turns return system + assistant(toolcall) + tool(result)', () => {
    const s = createCompactState({ systemPrompt: 'SYS', firstMessage: 'FIRST' });
    recordTurn(s, { step: 1, inlineText: 'thinking', tool: 'look', args: {}, result: '<map>xxx' });
    s.pendingCall = {
      id: 'call_1', name: 'look', argumentsJson: '{}',
      inlineText: 'thinking', result: '<map>xxx',
      reasoningDetails: [{ type: 'thought', text: 'r' }],
    };
    const msgs = buildMessages({ state: s, memory: 'my notes' });
    expect(msgs.map(m => m.role)).toEqual(['system', 'assistant', 'tool']);
    expect(msgs[0].content).toContain('my notes');
    expect(msgs[0].content).toContain('Last perception');
    expect(msgs[0].content).toContain('<map>xxx');
    expect(msgs[1].content).toBe('thinking');
    expect(msgs[1].tool_calls?.[0].function.name).toBe('look');
    expect(msgs[1].reasoning_details).toEqual([{ type: 'thought', text: 'r' }]);
    expect(msgs[2].tool_call_id).toBe('call_1');
    expect(msgs[2].content).toBe('<map>xxx');
  });

  it('abbreviates results to <action> tag when present', () => {
    expect(abbreviateResult('prelude <action tick="689"> Identified as luna </action> trailing'))
      .toBe('<action tick="689"> Identified as luna </action>');
    expect(abbreviateResult('no tag here  \n  yes')).toBe('no tag here yes');
  });

  it('recent-actions section uses tag-extracted form', () => {
    const s = createCompactState({ systemPrompt: 'S', firstMessage: 'F' });
    recordTurn(s, {
      step: 1, inlineText: '', tool: 'identify', args: { name: 'luna' },
      result: 'noise <action tick="689"> Identified as luna </action> more noise',
    });
    const sys = buildMessages({ state: s, memory: '' })[0].content!;
    const recent = sys.split('## Recent actions')[1].split('## ')[0];
    expect(recent).toContain('<action tick="689"> Identified as luna </action>');
    expect(recent).not.toContain('more noise');
  });

  it('renders action window with inline text and full args', () => {
    const s = createCompactState({ systemPrompt: 'S', firstMessage: 'F', actionWindowSize: 5 });
    recordTurn(s, { step: 1, inlineText: 'go north', tool: 'move', args: { dir: 'north' }, result: 'ok' });
    recordTurn(s, { step: 2, inlineText: '', tool: 'wait', args: {}, result: 'ok' });
    const sys = buildMessages({ state: s, memory: '' })[0].content!;
    expect(sys).toContain('[1]');
    expect(sys).toContain('"go north"');
    expect(sys).toContain('move({"dir":"north"})');
    expect(sys).toContain('[2]');
    expect(sys).toContain('wait({})');
  });
});
