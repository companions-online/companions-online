import { describe, it, expect } from 'vitest';
import { wrapChatMessage } from '@client-webgl/effects/chat-bubble.js';
import { chatLineAlpha } from '@client-webgl/ui/hud.js';

describe('wrapChatMessage', () => {
  it('leaves short messages untouched', () => {
    expect(wrapChatMessage('short msg')).toEqual(['short msg']);
  });

  it('wraps at first whitespace past minChars (default 20)', () => {
    expect(wrapChatMessage('tester tests test message tester tests')).toEqual([
      'tester tests test message',
      'tester tests',
    ]);
  });

  it('wraps multiple times across a long message', () => {
    // minChars=10: break at first space past index 10 from each line-start.
    // Start 0: "one two three four five six" → space at index 13 (before "four")
    //   Wait: "one two three four five six" — indices:
    //     0 'o' 1 'n' 2 'e' 3 ' ' 4 't' 5 'w' 6 'o' 7 ' ' 8 't' 9 'h' 10 'r' 11 'e' 12 'e'
    //     13 ' ' 14 'f' 15 'o' 16 'u' 17 'r' 18 ' ' 19 'f' 20 'i' 21 'v' 22 'e' 23 ' ' 24 's' 25 'i' 26 'x'
    //   Past index 10, first separator is index 13.
    //   Line 1: "one two three" (0..12). Remaining from 14: "four five six"
    // Start 14 (remaining length 13): 13 <= 10? no → break at first sep past idx 10.
    //   Remaining "four five six" — idx 10 is ' ' (separator). Split there.
    //   Actually local indices: 0 'f' 1 'o' 2 'u' 3 'r' 4 ' ' 5 'f' 6 'i' 7 'v' 8 'e' 9 ' ' 10 's' 11 'i' 12 'x'
    //   Past local idx 10: chars are s,i,x. No separator. Remainder pushed whole.
    //   Line 2: "four five six"
    expect(wrapChatMessage('one two three four five six', 10)).toEqual([
      'one two three',
      'four five six',
    ]);
  });

  it('treats punctuation as a separator, keeping the punctuation on the left line', () => {
    // minChars=5: "one,two,three four,five"
    //   i=0: scan from idx 5. 'w','o',',' → split after ',' (punctuation kept).
    //     Line 1 = "one,two,". i = 8.
    //   i=8: remaining 15, scan from local idx 5 → text[13]=' ' whitespace.
    //     Line 2 = "three". i = 14.
    //   i=14: remaining 9. Scan from local idx 5 → chars 'f','i','v','e', no
    //     separator past the floor. Push remainder as-is.
    //     Line 3 = "four,five".
    expect(wrapChatMessage('one,two,three four,five', 5)).toEqual([
      'one,two,',
      'three',
      'four,five',
    ]);
  });

  it('returns a single line when no separator exists past minChars', () => {
    expect(wrapChatMessage('supercalifragilisticexpialidocious', 20)).toEqual([
      'supercalifragilisticexpialidocious',
    ]);
  });

  it('handles empty string', () => {
    expect(wrapChatMessage('')).toEqual(['']);
  });
});

describe('chatLineAlpha', () => {
  it('is 1 while fresh', () => {
    expect(chatLineAlpha(0)).toBe(1);
    expect(chatLineAlpha(29_999)).toBe(1);
    expect(chatLineAlpha(30_000)).toBe(1);
  });

  it('linearly fades across the 5s tail', () => {
    expect(chatLineAlpha(32_500)).toBeCloseTo(0.5, 5);
    expect(chatLineAlpha(34_000)).toBeCloseTo(0.2, 5);
  });

  it('is 0 at and past lifetime', () => {
    expect(chatLineAlpha(35_000)).toBe(0);
    expect(chatLineAlpha(100_000)).toBe(0);
  });
});
