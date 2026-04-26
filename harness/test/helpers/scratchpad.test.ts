import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openScratchpad } from '../../helpers/scratchpad.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe('scratchpad', () => {
  it('creates an empty file and round-trips updates', () => {
    dir = mkdtempSync(join(tmpdir(), 'harness-scratchpad-'));
    const sp = openScratchpad('s1', dir);
    expect(sp.read()).toBe('');
    sp.update('## Goal\nexplore');
    expect(sp.read()).toBe('## Goal\nexplore');
  });

  it('isolates sessions by uuid', () => {
    dir = mkdtempSync(join(tmpdir(), 'harness-scratchpad-'));
    const a = openScratchpad('sA', dir);
    const b = openScratchpad('sB', dir);
    a.update('A');
    b.update('B');
    expect(a.read()).toBe('A');
    expect(b.read()).toBe('B');
  });
});
