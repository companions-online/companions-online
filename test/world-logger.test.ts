import { describe, it, expect } from 'vitest';
import { createMemoryLogger } from '../server/src/world-logger.js';

describe('WorldLogger — memory', () => {
  it('captures entries and counts warn/error', () => {
    const log = createMemoryLogger();
    log.info('hello', { a: 1 });
    log.warn('careful');
    log.error('boom', { why: 'x' });

    expect(log.entries).toHaveLength(3);
    expect(log.entries[0]).toMatchObject({ level: 'info', msg: 'hello', data: { a: 1 } });
    expect(log.warnCount).toBe(1);
    expect(log.errorCount).toBe(1);
  });

  it('assert returns true + logs nothing when condition holds', () => {
    const log = createMemoryLogger();
    const ok = log.assert(1 + 1 === 2, 'math works', { x: 2 });
    expect(ok).toBe(true);
    expect(log.entries).toHaveLength(0);
    expect(log.errorCount).toBe(0);
  });

  it('assert returns false + logs error with data on failure', () => {
    const log = createMemoryLogger();
    const ok = log.assert(false, 'impossible', { expected: 1, actual: 2 });
    expect(ok).toBe(false);
    expect(log.errorCount).toBe(1);
    expect(log.entries[0]).toMatchObject({
      level: 'error',
      msg: expect.stringContaining('impossible') as any,
      data: { expected: 1, actual: 2 },
    });
  });
});
