import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryFile } from '../memory-file.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe('memory-file', () => {
  it('creates an empty file and round-trips updates', () => {
    dir = mkdtempSync(join(tmpdir(), 'harness-mem-'));
    const mem = openMemoryFile('s1', dir);
    expect(mem.read()).toBe('');
    mem.update('## Goal\nexplore');
    expect(mem.read()).toBe('## Goal\nexplore');
  });

  it('isolates sessions by uuid', () => {
    dir = mkdtempSync(join(tmpdir(), 'harness-mem-'));
    const a = openMemoryFile('sA', dir);
    const b = openMemoryFile('sB', dir);
    a.update('A');
    b.update('B');
    expect(a.read()).toBe('A');
    expect(b.read()).toBe('B');
  });
});
