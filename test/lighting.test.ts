import { describe, it, expect } from 'vitest';
import {
  gameMinuteFromTick, gameHourFromTick, ambientTint,
  TICKS_PER_GAME_MINUTE, TICKS_PER_GAME_DAY,
} from '@shared/index.js';

describe('gameMinuteFromTick', () => {
  it('is zero at tick zero', () => {
    expect(gameMinuteFromTick(0)).toBe(0);
  });

  it('advances one minute every TICKS_PER_GAME_MINUTE ticks', () => {
    expect(gameMinuteFromTick(TICKS_PER_GAME_MINUTE)).toBe(1);
    expect(gameMinuteFromTick(TICKS_PER_GAME_MINUTE * 59)).toBe(59);
  });

  it('wraps at day boundary', () => {
    expect(gameMinuteFromTick(TICKS_PER_GAME_DAY)).toBe(0);
    expect(gameMinuteFromTick(TICKS_PER_GAME_DAY + TICKS_PER_GAME_MINUTE * 5)).toBe(5);
  });

  it('handles negative ticks', () => {
    expect(gameMinuteFromTick(-TICKS_PER_GAME_MINUTE)).toBe(1439);
  });
});

describe('gameHourFromTick', () => {
  it('is zero at tick zero', () => {
    expect(gameHourFromTick(0)).toBe(0);
  });

  it('reaches 12 at noon', () => {
    expect(gameHourFromTick(TICKS_PER_GAME_MINUTE * 60 * 12)).toBeCloseTo(12, 5);
  });
});

describe('ambientTint', () => {
  it('is full-bright at noon', () => {
    const [r, g, b] = ambientTint(12 * 60);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('is deep night at midnight', () => {
    const [r, g, b] = ambientTint(0);
    expect(r).toBeCloseTo(0.25, 5);
    expect(g).toBeCloseTo(0.30, 5);
    expect(b).toBeCloseTo(0.45, 5);
  });

  it('is deep night at 3:00', () => {
    const [r, g, b] = ambientTint(3 * 60);
    expect(r).toBeCloseTo(0.25, 5);
    expect(g).toBeCloseTo(0.30, 5);
    expect(b).toBeCloseTo(0.45, 5);
  });

  it('interpolates during sunrise (04:30)', () => {
    const [r] = ambientTint(4 * 60 + 30);
    // Halfway between (0.25) night and (0.55) mid-sunrise.
    expect(r).toBeCloseTo(0.4, 2);
  });

  it('interpolates during sunset (19:30)', () => {
    const [r] = ambientTint(19 * 60 + 30);
    // Halfway between (0.80) mid-sunset and (0.25) night.
    expect(r).toBeCloseTo(0.525, 2);
  });

  it('is day-bright at 06:00 keyframe', () => {
    const [r, g, b] = ambientTint(6 * 60);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('is night tint at 20:00 keyframe', () => {
    const [r, g, b] = ambientTint(20 * 60);
    expect(r).toBeCloseTo(0.25, 5);
    expect(g).toBeCloseTo(0.30, 5);
    expect(b).toBeCloseTo(0.45, 5);
  });
});
