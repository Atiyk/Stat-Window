/**
 * Daily policy: the official puzzle day is the UTC calendar date.
 * Everyone in the world plays the same slate at the same moment, and a new
 * one opens at 00:00 UTC. Puzzle No. 1 is EPOCH_DAY.
 */

export const EPOCH_DAY = '2026-11-15';
const DAY_MS = 24 * 60 * 60 * 1000;

export function puzzleDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function dayToUtcMs(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Not a day: ${day}`);
  return ms;
}

export function addDays(day: string, n: number): string {
  return new Date(dayToUtcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function puzzleNumber(day: string): number {
  return Math.round((dayToUtcMs(day) - dayToUtcMs(EPOCH_DAY)) / DAY_MS) + 1;
}

export function msUntilNextPuzzle(now: Date): number {
  const next = dayToUtcMs(puzzleDay(now)) + DAY_MS;
  return next - now.getTime();
}
