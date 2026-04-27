import { describe, it, expect } from 'vitest';
import { compactOldTurns, extractActionTag, extractKeyEvents } from '../../variants/shortened.js';
import type { ChatMessage } from '../../helpers/openrouter.js';

function turnPair(id: string, name: string, args: string, result: string, opts?: { content?: string; reasoning?: string }): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: opts?.content ?? null,
      ...(opts?.reasoning !== undefined ? { reasoning: opts.reasoning } : {}),
      tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
    },
    { role: 'tool', tool_call_id: id, content: result },
    { role: 'user', content: 'continue' },
  ];
}

describe('shortened.compactOldTurns', () => {
  it('keeps recent N turns intact, collapses older turns to single assistant line', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', 'noise <action tick="1"> looked </action> tail'),
      ...turnPair('c2', 'move', '{"dir":"n"}', '<action tick="2"> moved north </action>'),
      ...turnPair('c3', 'attack', '{"id":7}', '<action tick="3"> hit </action>'),
      ...turnPair('c4', 'harvest', '{}', '<action tick="4"> harvested </action>'),
    ];
    const out = compactOldTurns(messages, 2);

    // prefix: system, user(first); collapsed turns 1+2 become 2 assistant lines;
    // turns 3+4 (last 2) keep their full triple (assistant+tool+user).
    expect(out.map(m => m.role)).toEqual([
      'system', 'user',
      'assistant', 'assistant',                       // turn 1, turn 2 collapsed
      'assistant', 'tool', 'user',                    // turn 3 intact
      'assistant', 'tool', 'user',                    // turn 4 intact
    ]);

    // Compacted lines contain tool name, args, and the extracted <action> tag.
    expect(out[2].content).toContain('look({})');
    expect(out[2].content).toContain('<action tick="1"> looked </action>');
    expect(out[3].content).toContain('move({"dir":"n"})');
    expect(out[3].content).toContain('<action tick="2"> moved north </action>');
  });

  it('returns input unchanged when turns <= keepRecent', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', 'first'),
      ...turnPair('c2', 'move', '{}', 'second'),
    ];
    const out = compactOldTurns(messages, 2);
    expect(out).toBe(messages);
  });

  it('appends event hints when "said" or "died" appear in result', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', 'noise Alice said hi there <action>x</action>'),
      ...turnPair('c2', 'a', '{}', 'r'),
      ...turnPair('c3', 'b', '{}', 'r'),
    ];
    const out = compactOldTurns(messages, 2);
    expect(out[2].content).toContain('events:');
    expect(out[2].content).toContain('said');
  });

  it('includes assistant inline content verbatim, untruncated', () => {
    const longContent = 'a thought I had: ' + 'x'.repeat(500);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', '<action>r</action>', { content: longContent }),
      ...turnPair('c2', 'a', '{}', 'r'),
      ...turnPair('c3', 'b', '{}', 'r'),
    ];
    const out = compactOldTurns(messages, 2);
    expect(out[2].content).toContain(longContent);
    // No JSON.stringify wrapping or "said:" prefix from the old format.
    expect(out[2].content).not.toContain('said:');
  });

  it('extracts assistant reasoning into a <thinking> block, untruncated', () => {
    const longReasoning = 'thinking step '.repeat(200);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', '<action>r</action>', { reasoning: longReasoning }),
      ...turnPair('c2', 'a', '{}', 'r'),
      ...turnPair('c3', 'b', '{}', 'r'),
    ];
    const out = compactOldTurns(messages, 2);
    expect(out[2].content).toContain(`<thinking>${longReasoning}</thinking>`);
  });

  it('does not truncate the tool result fallback when no <action> tag is present', () => {
    const longResult = 'no action tag here, ' + 'y'.repeat(500);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'go' },
      ...turnPair('c1', 'look', '{}', longResult),
      ...turnPair('c2', 'a', '{}', 'r'),
      ...turnPair('c3', 'b', '{}', 'r'),
    ];
    const out = compactOldTurns(messages, 2);
    expect(out[2].content).toContain(longResult);
  });
});

describe('shortened helpers', () => {
  it('extractActionTag pulls the first <action>...</action> block (single-lined)', () => {
    expect(extractActionTag('pre <action tick="9"> did something\n  ok </action> post'))
      .toBe('<action tick="9"> did something ok </action>');
    expect(extractActionTag('no tag')).toBe(null);
  });

  it('extractKeyEvents finds "said" and "died" mentions', () => {
    const evs = extractKeyEvents('blah Alice said hello more wolf died here');
    expect(evs.length).toBe(2);
    expect(evs[0]).toContain('said');
    expect(evs[1]).toContain('died');
  });
});
