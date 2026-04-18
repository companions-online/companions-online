import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { TICKS_PER_GAME_HOUR } from '@shared/constants.js';
import { gameMinuteFromTick } from '@shared/lighting.js';

describe('E2E: Environment sync', () => {
  it('emits an env section when the in-game hour crosses a keyframe', () => {
    // Start at a tick that is 1 tick before the 04:00 keyframe (04:00 = hour 4,
    // i.e. 4 × 720 = 2880 ticks). Private _tick increments before env check,
    // so we need to run exactly (2880 - current) ticks to land on 04:00.
    const world = createTestWorld();
    const { connection: c } = addTestPlayer(world, 10, 10);
    // Run a few ticks to prime the player into the world (no keyframe between
    // 0 and this point, so no env emit expected yet).
    world.runTicks(10);
    c.events.length = 0;

    // Advance to exactly tick = 4 × TICKS_PER_GAME_HOUR (04:00 keyframe).
    const ticksToKeyframe = 4 * TICKS_PER_GAME_HOUR - world.currentTick;
    world.runTicks(ticksToKeyframe);

    const envTicks = c.events.filter(e => e.type === 'tick' && e.data?.environment);
    expect(envTicks.length).toBeGreaterThanOrEqual(1);
    const last = envTicks[envTicks.length - 1];
    expect(last.data?.environment?.gameMinute).toBe(4 * 60);
    expect(last.data?.environment?.weather).toBe(0);
  });

  it('does not re-emit during flat day/night spans', () => {
    const world = createTestWorld();
    const { connection: c } = addTestPlayer(world, 10, 10);
    // Skip to mid-night (02:00 — between the 00:00 and 04:00 keyframes).
    world.runTicks(2 * TICKS_PER_GAME_HOUR);
    c.events.length = 0;

    // Run for 30 in-game minutes — still in flat-night range (02:00 → 02:30),
    // no keyframe crossed.
    world.runTicks(TICKS_PER_GAME_HOUR / 2);

    const envTicks = c.events.filter(e => e.type === 'tick' && e.data?.environment);
    expect(envTicks.length).toBe(0);
  });

  it('setTickOffset forces the next broadcast to emit', () => {
    const world = createTestWorld();
    const { connection: c } = addTestPlayer(world, 10, 10);
    // Prime past the first broadcast so the forced-resync on boot doesn't
    // fire again; world.tickOffset is still 0 here because createTestWorld
    // uses `new GameWorld(...)` directly (no createNewWorld seeding).
    world.runTicks(10);
    c.events.length = 0;

    // Shift offset by 6 in-game hours. Current tick ~10 maps to gameMinute ~0
    // without offset; with offset=6h, gameMinute = 6*60 = 360 (just-past-sunrise).
    world.setTickOffset(6 * TICKS_PER_GAME_HOUR);
    world.runTicks(1);

    const envTicks = c.events.filter(e => e.type === 'tick' && e.data?.environment);
    expect(envTicks.length).toBe(1);
    const expected = gameMinuteFromTick(world.effectiveTick);
    expect(envTicks[0].data?.environment?.gameMinute).toBe(expected);
  });

  it('setTickOffset emits even when the new hour is not a keyframe', () => {
    const world = createTestWorld();
    const { connection: c } = addTestPlayer(world, 10, 10);
    world.runTicks(10);
    c.events.length = 0;

    // Offset to 02:00 (02:00 is not in KEYFRAME_HOURS). Without the forced-
    // resync path, the broadcast would skip env emission.
    world.setTickOffset(2 * TICKS_PER_GAME_HOUR);
    world.runTicks(1);

    const envTicks = c.events.filter(e => e.type === 'tick' && e.data?.environment);
    expect(envTicks.length).toBe(1);
  });

  it('effectiveTick = currentTick + tickOffset', () => {
    const world = createTestWorld();
    world.tickOffset = 1234;
    world.runTicks(5);
    expect(world.currentTick).toBe(5);
    expect(world.effectiveTick).toBe(5 + 1234);
  });

  it('re-emits on weather change', () => {
    const world = createTestWorld();
    const { connection: c } = addTestPlayer(world, 10, 10);
    world.runTicks(10);
    c.events.length = 0;

    world.weather = 2;
    world.runTicks(1);

    const envTicks = c.events.filter(e => e.type === 'tick' && e.data?.environment);
    expect(envTicks.length).toBe(1);
    expect(envTicks[0].data?.environment?.weather).toBe(2);
  });
});
