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
