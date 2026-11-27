import { addDays } from './daily';
import type { RoundRecord } from './game';
import type { SavedRun } from './storage';

export const MAX_TOTAL = 500;

/** Legacy scores have no elapsed time; never pretend they do. */
export function answerTimeMs(results: readonly RoundRecord[]): number | null {
  if (results.length !== 5 || results.some((r) => r.elapsedMs === undefined)) return null;
  return results.reduce((sum, r) => sum + (r.elapsedMs ?? 0), 0);
}

export function formatAnswerTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** One mark per round. Shape tells the story; no answers leak.
 * Emoji squares are the share-text convention of daily games (pasted into chats), never UI. */
export function roundMark(r: RoundRecord): string {
  if (!r.hit) return '⬛'; // taste-skill-ignore
  if (r.points >= 75) return '🟩'; // taste-skill-ignore
  if (r.points >= 40) return '🟨'; // taste-skill-ignore
  return '🟧'; // taste-skill-ignore
}

/** Spoiler-free share: score, one mark per round, an invitation and a link to the same five questions. */
export function shareText(opts: {
  number?: number;
  /** Public label ("No. 4", "Beta No. 4"); wins over `number`. */
  label?: string;
  results: readonly RoundRecord[];
  url: string;
  /** Only a verified, sample-gated line ("82nd percentile today, 214 games"). */
  percentile?: string | null;
  answerMs?: number | null;
  untimed?: boolean;
}): string {
  const total = opts.results.reduce((s, r) => s + r.points, 0);
  const detail = opts.untimed ? ' · Untimed practice' : opts.answerMs != null ? ` · ${formatAnswerTime(opts.answerMs)}` : '';
  return [
    `Stat Window ${opts.label ?? `No. ${opts.number ?? 0}`}  ${total}/${MAX_TOTAL}${detail}`,
    opts.results.map(roundMark).join(''),
    ...(opts.percentile ? [opts.percentile] : []),
    inviteLine(total, opts.untimed),
    opts.url,
  ].join('\n');
}

/** The invitation under a shared score, the same in the text and on the card image. */
export const inviteLine = (total: number, untimed = false): string =>
  total > 0 && !untimed ? `Think you know ball? Beat ${total}.` : 'Same five questions. Your turn.';

export type StreakMilestone = 3 | 7 | 30;

export function streakMilestone(days: number): StreakMilestone | null {
  return days === 3 || days === 7 || days === 30 ? days : null;
}

export type OfficialHighlight = { lastBest: number | null; milestone: StreakMilestone | null };

/** Earlier question order breaks ties between equally high-scoring windows. */
export function postgameHighlight(results: readonly RoundRecord[], official?: OfficialHighlight): string {
  const total = results.reduce((sum, round) => sum + round.points, 0);
  if (official && official.lastBest !== null && total > official.lastBest) {
    const gain = total - official.lastBest;
    return `New personal best by ${gain} ${gain === 1 ? 'point' : 'points'}.`;
  }
  if (official?.milestone) return `${official.milestone} days in a row.`;

  const perfect = results.filter((round) => round.hit && round.points === 100).length;
  if (perfect > 1) return `${perfect} perfect windows.`;

  let bestWindow = -1;
  let hits = 0;
  results.forEach((round, index) => {
    if (!round.hit) return;
    hits++;
    if (bestWindow < 0 || round.points > results[bestWindow]!.points) bestWindow = index;
  });
  if (bestWindow >= 0 && results[bestWindow]!.points > 0) {
    if (perfect === 1) return `Perfect window on question ${bestWindow + 1}.`;
    const best = results[bestWindow]!.points;
    return `Your best window was Q${bestWindow + 1} (${best} ${best === 1 ? 'point' : 'points'}).`;
  }
  if (hits === 0) return 'No points scored this game.';
  return `${hits} of ${results.length} windows caught the answer without scoring.`;
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
