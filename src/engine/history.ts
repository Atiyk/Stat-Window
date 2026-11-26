/**
 * Eligible official history: the one statistics foundation shared by the Weekly
 * Scoreboard, the Scouting Report and the home screen.
 *
 * A saved run counts only when ALL of these hold (docs/V5.1-STATS.md):
 * - it is an official daily record (`runs`; practice and untimed practice are separate stores),
 * - its day is a real puzzle day in the current season (`inSeason`; beta never leaks into s1),
 * - it is not in the future,
 * - it is a finished five-round run (advanced and saved results both equal five),
 * - its saved windows verify against the published slate with exactly the game's
 *   scoring rules (`verifiedDailyRounds`, the same check the personal-best goal uses).
 *
 * A finished run that cannot be loaded or verified is reported as `unavailable`
 * rather than silently dropped or counted.
 */
import type { Slate } from '../content/schema';
import { EPOCH_DAY } from './daily';
import { verifiedDailyRounds } from './final-shot';
import { ROUNDS, totalPoints, type RoundRecord } from './game';
import { inSeason, isIsoDay, type SeasonConfig, type SeasonId } from './season';
import type { SavedRun } from './storage';

export type EligibleRecord = {
  readonly day: string;
  readonly slate: Slate;
  readonly rounds: readonly RoundRecord[];
  readonly total: number;
};

export type OfficialHistory = {
  /** Verified records, oldest first. */
  readonly records: readonly EligibleRecord[];
  /** Finished official runs in the season that could not be verified (slate missing, mismatch, tampering). */
  readonly unavailable: readonly string[];
};

export const EMPTY_HISTORY: OfficialHistory = { records: [], unavailable: [] };

const isFinished = (run: SavedRun | undefined): run is SavedRun =>
  run !== undefined && run.advanced === ROUNDS && run.results.length === ROUNDS;

/** Days whose saved run is a finished official run of `season`, oldest first, optionally within [from, to]. */
export function finishedDays(
  runs: Readonly<Record<string, SavedRun>>,
  season: SeasonId,
  config: SeasonConfig,
  today: string,
  range: { from?: string; to?: string } = {},
): string[] {
  return Object.entries(inSeason(runs, season, config))
    .filter(([day, run]) => isIsoDay(day) && day >= EPOCH_DAY && day <= today && isFinished(run)
      && (range.from === undefined || day >= range.from) && (range.to === undefined || day <= range.to))
    .map(([day]) => day)
    .sort();
}

/** Pure core: verify finished runs against whichever slates were loaded (null = unavailable). */
export function buildHistory(
  runs: Readonly<Record<string, SavedRun>>,
  season: SeasonId,
  config: SeasonConfig,
  today: string,
  slates: Readonly<Record<string, Slate | null | undefined>>,
  range: { from?: string; to?: string } = {},
): OfficialHistory {
  const records: EligibleRecord[] = [];
  const unavailable: string[] = [];
  for (const day of finishedDays(runs, season, config, today, range)) {
    const run = runs[day]!;
    const slate = slates[day];
    if (slate && slate.date === day && verifiedDailyRounds(slate, run.results)) {
      records.push({ day, slate, rounds: run.results, total: totalPoints(run.results) });
    } else unavailable.push(day);
  }
  return { records, unavailable };
}

/** Loads only the slates the range needs (a week needs at most seven), then verifies. */
export async function loadOfficialHistory(
  runs: Readonly<Record<string, SavedRun>>,
  season: SeasonId,
  config: SeasonConfig,
  today: string,
  loadSlate: (day: string) => Promise<Slate | null>,
  range: { from?: string; to?: string } = {},
): Promise<OfficialHistory> {
  const days = finishedDays(runs, season, config, today, range);
  const slates: Record<string, Slate | null> = {};
  await Promise.all(days.map(async (day) => {
    try {
      slates[day] = await loadSlate(day);
    } catch {
      slates[day] = null;
    }
  }));
  return buildHistory(runs, season, config, today, slates, range);
}
