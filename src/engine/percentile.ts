/**
 * Daily score percentiles. Spec: docs/PERCENTILES.md.
 *
 * Shared by the browser and the score API so both compute the same number from
 * the same compact distribution: `counts[s]` is how many eligible first-play
 * submissions scored exactly `s` (0..500) on one canonical puzzle day and season.
 *
 * Midrank percentile, ties get half credit:
 *   p(s) = 100 × (count(score < s) + 0.5 × count(score = s)) / N
 * Because of the half credit for ties this is never phrased as "beat X% of players".
 */
/** Kept equal to summary.ts MAX_TOTAL by a test; no imports so the score API can bundle this file alone. */
export const MAX_TOTAL = 500;

/**
 * Below this many eligible submissions the percentile is not shown at all.
 * A product-quality floor, not a claim that 100 browsers represent all players.
 */
export const PERCENTILE_MIN_SAMPLE = 100;

/**
 * Below this many eligible games the results screen says nothing about the tally at all;
 * from here up to PERCENTILE_MIN_SAMPLE it shows "Percentiles unlock at 100 games today: N so far".
 * An owner decision (2026-11-21 UI sweep, BUG-04): "N of 100 needed" read like the player's own progress.
 */
export const PERCENTILE_PROGRESS_FROM = 50;

export type Distribution = readonly number[];

export function emptyDistribution(): number[] {
  return Array.from({ length: MAX_TOTAL + 1 }, () => 0);
}

/** A valid distribution has exactly 501 non-negative integer buckets. */
export function isDistribution(x: unknown): x is Distribution {
  return Array.isArray(x) && x.length === MAX_TOTAL + 1 && x.every((c) => Number.isInteger(c) && c >= 0);
}

export function sampleSize(counts: Distribution): number {
  let n = 0;
  for (const c of counts) n += c;
  return n;
}

export type PercentileResult = {
  /** Unrounded midrank percentile, 0..100. */
  readonly exact: number;
  /** Whole-number percentile for display, 0..100. */
  readonly rounded: number;
  readonly n: number;
  readonly below: number;
  readonly equal: number;
};

/**
 * Midrank percentile of `score` within `counts`. Returns null for an empty
 * population or a score outside 0..500. The player's own submission is expected
 * to already be inside `counts` (it was counted when it was stored).
 */
export function midrankPercentile(counts: Distribution, score: number): PercentileResult | null {
  if (!Number.isInteger(score) || score < 0 || score > MAX_TOTAL) return null;
  if (!isDistribution(counts)) return null;
  const n = sampleSize(counts);
  if (n === 0) return null;
  let below = 0;
  for (let s = 0; s < score; s++) below += counts[s]!;
  const equal = counts[score]!;
  const exact = (100 * (below + 0.5 * equal)) / n;
  return { exact, rounded: Math.min(100, Math.max(0, Math.round(exact))), n, below, equal };
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** What the results screen may say, given what the API returned. */
export type PercentileView =
  | { kind: 'ready'; label: string; detail: string; percentile: number; n: number }
  | { kind: 'gathering'; label: string; n: number }
  | { kind: 'unavailable'; label: string };

export function percentileView(
  input: { counts: Distribution | null; n: number; score: number } | null,
  minSample = PERCENTILE_MIN_SAMPLE,
): PercentileView {
  if (!input) return { kind: 'unavailable', label: 'Today’s percentile isn’t available right now.' };
  if (input.n < minSample || !input.counts) {
    return { kind: 'gathering', label: 'Not enough completed games for today’s percentile yet.', n: input.n };
  }
  const p = midrankPercentile(input.counts, input.score);
  if (!p) return { kind: 'unavailable', label: 'Today’s percentile isn’t available right now.' };
  const games = p.n.toLocaleString('en-US');
  return {
    kind: 'ready',
    label: `${ordinal(p.rounded)} percentile today`,
    detail: `based on ${games} eligible completed ${p.n === 1 ? 'game' : 'games'}`,
    percentile: p.rounded,
    n: p.n,
  };
}

/* ------------------------------------------------------------------------------------------
 * Question comparison (docs/PERCENTILES.md, "Question comparison"). Shared by the score API,
 * which aggregates server-verified windows, and the browser, which only reads the summary.
 * ------------------------------------------------------------------------------------------ */

/** One round is worth 0..100 points (kept equal to scoring.ts MAX_POINTS_PER_ROUND by a test). */
export const MAX_ROUND_POINTS = 100;

/**
 * A share ("38% scored") is published only when both the cell and its complement hold at least
 * this many games, so a near-unanimous question never pins down a handful of people.
 */
export const SMALL_CELL = 5;

/**
 * How one verified round counts, decided by the server from the window alone:
 * - `t` full scale: the game records a shot-clock violation as the whole scale, and a player
 *   can never lock the whole scale themselves, so this is a timeout (in every client version);
 * - `m` the window does not contain the answer (a miss; never inferred from zero points);
 * - `z` the window contains the answer but is too wide to score (a zero-point catch);
 * - 1..100 a scoring catch with that many points.
 */
export type QuestionOutcome = 't' | 'm' | 'z' | number;

/** Counts for one question: `scoring[p]` games scored exactly p (1..100); index 0 is unused. */
export type QuestionTally = { scoring: number[]; zero: number; miss: number; timeout: number };

export function emptyTally(): QuestionTally {
  return { scoring: Array.from({ length: MAX_ROUND_POINTS + 1 }, () => 0), zero: 0, miss: 0, timeout: 0 };
}

export function tallySize(t: QuestionTally): number {
  return t.zero + t.miss + t.timeout + t.scoring.reduce((a, b) => a + b, 0);
}

/** What the API publishes per question. Statistics appear only at or above the sample gate. */
export type QuestionStat = {
  readonly id: string;
  readonly n: number;
  readonly ready: boolean;
  /** Rounded midrank percentile of each points value 0..100 among the eligible games. */
  readonly pct?: readonly number[];
  /** Rounded % of eligible games that scored (a catch worth at least 1 point). */
  readonly scored?: number;
  /** Rounded % of eligible games whose window missed the answer (timeouts are not misses). */
  readonly missed?: number;
};

/** Published percentiles are multiples of this, so the table stays coarse. */
export const PCT_STEP = 5;

const share = (part: number, n: number) => (part >= SMALL_CELL && n - part >= SMALL_CELL ? Math.round((100 * part) / n) : undefined);

export function summarizeQuestion(id: string, t: QuestionTally, minSample = PERCENTILE_MIN_SAMPLE): QuestionStat {
  const n = tallySize(t);
  if (n < minSample || n === 0) return { id, n, ready: false };
  // Points histogram with every zero-point outcome (miss, timeout, too-wide catch) at 0.
  const counts = [t.zero + t.miss + t.timeout, ...t.scoring.slice(1)];
  const scoredCount = n - counts[0]!;
  // The table is withheld while the zero cell or the scoring cell holds 1 to 4 games
  // (it would reveal the small count the shares hide; an empty cell reveals nothing
  // about anyone), and published in steps of PCT_STEP points, so neighbouring entries
  // can't be differenced back into single-game cells.
  const small = (c: number) => c > 0 && c < SMALL_CELL;
  let pct: number[] | undefined;
  if (!small(counts[0]!) && !small(scoredCount)) {
    pct = [];
    let below = 0;
    for (let p = 0; p <= MAX_ROUND_POINTS; p++) {
      const equal = counts[p]!;
      const exact = (100 * (below + 0.5 * equal)) / n;
      pct.push(Math.min(100, Math.max(0, Math.round(exact / PCT_STEP) * PCT_STEP)));
      below += equal;
    }
  }
  const scored = share(scoredCount, n);
  const missed = share(t.miss, n);
  return { id, n, ready: true, ...(pct ? { pct } : {}), ...(scored !== undefined ? { scored } : {}), ...(missed !== undefined ? { missed } : {}) };
}

const pctInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;

/** Strict check of a QuestionStat from the network; anything odd is dropped, never repaired. */
export function isQuestionStat(x: unknown): x is QuestionStat {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  if (typeof s.id !== 'string' || !Number.isInteger(s.n) || (s.n as number) < 0 || typeof s.ready !== 'boolean') return false;
  if (s.pct !== undefined && !(Array.isArray(s.pct) && s.pct.length === MAX_ROUND_POINTS + 1 && s.pct.every(pctInt))) return false;
  if (s.scored !== undefined && !pctInt(s.scored)) return false;
  if (s.missed !== undefined && !pctInt(s.missed)) return false;
  return true;
}

const games = (n: number) => `${n.toLocaleString('en-US')} eligible completed ${n === 1 ? 'game' : 'games'}`;

/**
 * The one reveal line, or null. A scoring catch gets its midrank percentile ("for this question",
 * never "beat X%"); any zero-point round gets the crowd's scoring share instead, which says nothing
 * about why this player scored zero.
 */
export function questionCrowdLine(stat: QuestionStat | null | undefined, points: number, minSample = PERCENTILE_MIN_SAMPLE): string | null {
  if (!stat || !stat.ready || stat.n < Math.max(1, minSample)) return null;
  if (!Number.isInteger(points) || points < 0 || points > MAX_ROUND_POINTS) return null;
  // The table is in steps of 5; the ends are shown as 5th and 95th, never 0th or 100th.
  if (points > 0 && stat.pct) return `${ordinal(Math.min(95, Math.max(5, stat.pct[points]!)))} percentile for this question, among ${games(stat.n)}.`;
  if (stat.scored !== undefined) return `${stat.scored}% of ${games(stat.n)} scored on this question.`;
  return null;
}

/** Today's hardest question for the crowd (lowest scoring share), only when all five are publishable and one is clearly lowest. */
export function toughestQuestion(stats: readonly (QuestionStat | null | undefined)[], minSample = PERCENTILE_MIN_SAMPLE): { index: number; scored: number; n: number } | null {
  if (stats.length !== 5) return null;
  const ok = stats.every((s) => s && s.ready && s.n >= Math.max(1, minSample) && s.scored !== undefined);
  if (!ok) return null;
  const shares = stats.map((s) => s!.scored!);
  const low = Math.min(...shares);
  if (shares.filter((v) => v === low).length !== 1) return null;
  const index = shares.indexOf(low);
  return { index, scored: low, n: stats[index]!.n };
}
