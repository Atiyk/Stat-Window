/**
 * First NBA-only day (UTC). Earlier days are the mixed-sport launch puzzles and
 * stay playable. Kept equal to data/nba/calendar.json `cutover` by
 * `npm run nba:reschedule` (a test fails if they differ).
 */
export const NBA_CUTOVER = '2026-11-17';

export const isMixedSportDay = (day: string): boolean => day < NBA_CUTOVER;
