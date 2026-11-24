import type { Slate } from '../content/schema';
import { normalizeWindow, ROUNDS, totalPoints, type RoundRecord } from './game';
import { MAX_POINTS_PER_ROUND, scoreWindow } from './scoring';
import { EPOCH_DAY } from './daily';
import { isIsoDay, seasonOf, type SeasonConfig } from './season';
import type { SavedRun } from './storage';

export type FinalShot = { kind: 'target'; points: number } | { kind: 'surpassed' };

/** Only strict improvements count. A new record may already be in hand. */
export function finalShot(previousBest: number | null, runningTotal: number): FinalShot | null {
  if (previousBest === null) return null;
  const needed = previousBest + 1 - runningTotal;
  if (needed <= 0) return { kind: 'surpassed' };
  return needed <= MAX_POINTS_PER_ROUND ? { kind: 'target', points: needed } : null;
}

/** Match saved windows against the slate, using exactly the game's scoring rules. */
export function verifiedDailyRounds(slate: Slate, results: readonly RoundRecord[]): boolean {
  return results.length <= ROUNDS && results.every((saved, i) => {
    const question = slate.questions[i];
    if (!question || saved.questionId !== question.id) return false;
    const { min, max, step } = question;
    if (!Number.isFinite(saved.lo) || !Number.isFinite(saved.hi)) return false;
    if (saved.timedOut) {
      return saved.lo === min && saved.hi === max && !saved.hit && saved.points === 0 && saved.missBy === 0;
    }

    const window = normalizeWindow(question, saved);
    // Allow representation noise in legacy decimal saves, within a tiny fraction of one step.
    const onGrid = Math.abs(window.lo - saved.lo) <= step * 1e-9 && Math.abs(window.hi - saved.hi) <= step * 1e-9;
    if (!onGrid) return false;
    const scored = scoreWindow(question, window);
    return saved.hit === scored.hit && saved.points === scored.points && saved.missBy === scored.missBy;
  });
}

/** Only completed official runs before this day in its own season are eligible.
 * Try the highest saved totals first so a normal visit loads at most one historic slate.
 * If that chunk is temporarily unavailable, callers omit the goal for this visit.
 */
export async function verifiedPreviousBest(
  runs: Readonly<Record<string, SavedRun>>,
  day: string,
  season: SeasonConfig,
  loadSlate: (day: string) => Promise<Slate | null>,
): Promise<number | null> {
  const candidates = Object.entries(runs)
    .filter(([date, run]) => isIsoDay(date) && date >= EPOCH_DAY && date < day
      && seasonOf(date, season) === seasonOf(day, season)
      && run.advanced === ROUNDS && run.results.length === ROUNDS)
    .map(([date, run]) => ({ date, run, total: totalPoints(run.results) }))
    .sort((a, b) => b.total - a.total);

  for (const { date, run, total } of candidates) {
    const slate = await loadSlate(date);
    if (slate?.date === date && verifiedDailyRounds(slate, run.results)) return total;
  }
  return null;
}
