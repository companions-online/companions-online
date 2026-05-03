import { describe, it, expect } from 'vitest';
import { createRateTracker } from '../../helpers/rate-tracker.js';

describe('rate-tracker', () => {
  it('returns 0 when nothing has been pushed', () => {
    const r = createRateTracker();
    expect(r.rate(10_000, 1_000)).toBe(0);
  });

  it('ignores zero-completion pushes (no-op turns shouldn\'t inflate the window)', () => {
    const r = createRateTracker();
    r.push(0, 1_000);
    expect(r.rate(10_000, 2_000)).toBe(0);
  });

  it('computes tokens/sec across multiple pushes within the window', () => {
    const r = createRateTracker();
    // 30 + 30 + 40 = 100 tokens between t=0 and t=10000ms → 10 tps
    r.push(30, 0);
    r.push(30, 5_000);
    r.push(40, 10_000);
    expect(r.rate(10_000, 10_000)).toBeCloseTo(10, 5);
  });

  it('drops entries older than the window', () => {
    const r = createRateTracker();
    r.push(100, 0);       // outside window when reading at t=20000
    r.push(50, 15_000);   // inside window
    expect(r.rate(10_000, 20_000)).toBeCloseTo(50 * 1000 / 5_000, 5);
  });

  it('uses elapsed (not full window) as denominator early in the run', () => {
    const r = createRateTracker();
    // First (and only) push 1s ago — denom should be 1s, not 10s.
    r.push(20, 9_000);
    expect(r.rate(10_000, 10_000)).toBeCloseTo(20, 5);
  });
});
