// Day/night cycle. Server derives `gameMinute` from `world.currentTick` via
// `gameMinuteFromTick`; the same fn runs on the client, advancing from the
// last server-synced tick using elapsed wall-clock. `ambientTint` interpolates
// linearly between keyframes to produce an RGB multiplier that both
// terrain and sprite shaders apply.

import { TICKS_PER_GAME_MINUTE, TICKS_PER_GAME_HOUR, GAME_MINUTES_PER_DAY } from './constants.js';

export const MORNING_TICK_OFFSET = 5 * TICKS_PER_GAME_HOUR;

/** Default tickOffset for newly-created worlds — lands them at 19:00
 *  (mid-sunset) so the first boot shows an interesting lighting state. */
export const TWILIGHT_TICK_OFFSET = 19 * TICKS_PER_GAME_HOUR;

export type RGB = readonly [number, number, number];

/** Minute-of-day (0..1440) from absolute tick, wrapping at day boundaries. */
export function gameMinuteFromTick(tick: number): number {
  const m = Math.floor(tick / TICKS_PER_GAME_MINUTE) % GAME_MINUTES_PER_DAY;
  return m < 0 ? m + GAME_MINUTES_PER_DAY : m;
}

/** Fractional hour (0..24), continuous across tile sync granularity. */
export function gameHourFromTick(tick: number): number {
  return gameMinuteFromTick(tick) / 60;
}

interface Keyframe { hour: number; rgb: RGB; }

/** Keyframes ordered by hour. Linear RGB interpolation between adjacent
 *  entries. Wrap-around is handled by treating hour 24 == hour 0. */
const KEYFRAMES: readonly Keyframe[] = [
  { hour:  0, rgb: [0.25, 0.30, 0.45] }, // deep night
  { hour:  4, rgb: [0.25, 0.30, 0.45] },
  { hour:  5, rgb: [0.55, 0.45, 0.40] }, // mid-sunrise
  { hour:  6, rgb: [1.00, 1.00, 1.00] }, // full day
  { hour: 18, rgb: [1.00, 1.00, 1.00] },
  { hour: 19, rgb: [0.80, 0.55, 0.40] }, // mid-sunset
  { hour: 20, rgb: [0.25, 0.30, 0.45] },
  { hour: 24, rgb: [0.25, 0.30, 0.45] },
];

/** Ambient tint for the given minute-of-day (0..1440). */
export function ambientTint(gameMinute: number): RGB {
  const h = gameMinute / 60;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    if (h >= a.hour && h <= b.hour) {
      const t = (h - a.hour) / (b.hour - a.hour);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ];
    }
  }
  // Unreachable given KEYFRAMES span [0,24].
  return KEYFRAMES[0].rgb;
}

/** Hour boundaries where the schedule slope changes — emit an env sync on
 *  crossing each. Day/night spans are flat, so no mid-span updates are needed. */
export const KEYFRAME_HOURS: readonly number[] = [4, 5, 6, 18, 19, 20];
