import { addDays } from './daily';
import type { RoundRecord } from './game';
import type { SavedRun } from './storage';

export const MAX_TOTAL = 500;

/** One mark per round. Shape tells the story; no answers leak.
 * Emoji squares are the share-text convention of daily games (pasted into chats), never UI. */
export function roundMark(r: RoundRecord): string {
  if (!r.hit) return '⬛'; // taste-skill-ignore
  if (r.points >= 75) return '🟩'; // taste-skill-ignore
  if (r.points >= 40) return '🟨'; // taste-skill-ignore
  return '🟧'; // taste-skill-ignore
}

/** Spoiler-free share: score, one mark per round, an invitation and a link to the same five questions. */
export function shareText(opts: { number: number; results: readonly RoundRecord[]; url: string }): string {
  const total = opts.results.reduce((s, r) => s + r.points, 0);
  return [
    `Stat Window No. ${opts.number}  ${total}/${MAX_TOTAL}`,
    opts.results.map(roundMark).join(''),
    total > 0 ? `Same five questions. Can you beat ${total}?` : 'Same five questions. Your turn.',
    opts.url,
  ].join('\n');
}

export function verdict(total: number): string {
  if (total >= 450) return 'Record-book stuff.';
  if (total >= 350) return 'All-star read.';
  if (total >= 250) return 'Starter material.';
  if (total >= 150) return 'Solid minutes.';
  if (total >= 50) return 'Rough day at the office.';
  return 'Tomorrow’s a new game.';
}

export type PlayerStats = {
  played: number;
  average: number;
  best: number;
  streak: number;
  longest: number;
  /** Completed days per 100-point band: 0–99, 100–199, 200–299, 300–399, 400–500. */
  distribution: readonly number[];
};

const isComplete = (r: SavedRun | undefined) => (r?.results.length ?? 0) >= 5;

export function playerStats(runs: Readonly<Record<string, SavedRun>>, today: string): PlayerStats {
  const done = Object.entries(runs).filter(([, r]) => isComplete(r)).sort(([a], [b]) => a.localeCompare(b));
  const totals = done.map(([, r]) => r.results.reduce((s, x) => s + x.points, 0));
  let longest = 0;
  let run = 0;
  let prev: string | undefined;
  for (const [day] of done) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  let streak = 0;
  let cursor = isComplete(runs[today]) ? today : addDays(today, -1);
  while (isComplete(runs[cursor])) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return {
    played: done.length,
    average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
    best: totals.length ? Math.max(...totals) : 0,
    streak,
    longest,
    distribution: [0, 1, 2, 3, 4].map((band) => totals.filter((t) => Math.min(4, Math.floor(t / 100)) === band).length),
  };
}
