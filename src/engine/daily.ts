/**
 * Daily policy: the official puzzle day changes at 12:00 AM America/New_York.
 * Everyone in the world plays the same slate at the same moment, and a new
 * one opens at midnight Eastern (DST-aware). Puzzle No. 1 is EPOCH_DAY.
 */

export const EPOCH_DAY = '2026-11-15';
export const PUZZLE_TIME_ZONE = 'America/New_York';
const easternParts = new Intl.DateTimeFormat('en-US', { timeZone: PUZZLE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY_MS = 24 * 60 * 60 * 1000;

export function puzzleDay(now: Date): string {
  const parts = easternParts.formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
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

/** Exact midnight in New York for an ISO day, including the spring/fall DST boundaries. */
export function puzzleStartUtcMs(day: string): number {
  const utc = dayToUtcMs(day);
  // Modern Eastern midnights are 04:00Z or 05:00Z; search all offsets
  // instead of assuming a fixed UTC offset or a 24-hour local day.
  for (let hour = 1; hour <= 12; hour++) {
    const candidate = utc + hour * 3_600_000;
    if (puzzleDay(new Date(candidate)) === day) return candidate;
  }
  throw new RangeError(`Cannot find Eastern midnight for ${day}`);
}

export function msUntilNextPuzzle(now: Date): number {
  return puzzleStartUtcMs(addDays(puzzleDay(now), 1)) - now.getTime();
}
