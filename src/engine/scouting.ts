/**
 * Scouting Report calculations over eligible official history (src/engine/history.ts).
 * Everything is descriptive. Thresholds and wording rules are documented in
 * docs/V5.1-STATS.md; change them in both places.
 */
import franchises from '../../data/nba/franchises.json';
import { formatOf, isPlayerFormat } from '../content/formats';
import type { Question } from '../content/schema';
import type { EligibleRecord } from './history';
import type { RoundRecord } from './game';
import { potentialPoints } from './scoring';
import { playerStats, type PlayerStats } from './summary';

/** Fewest attempts in one category or risk band before the report states a conclusion about it. */
export const MIN_CATEGORY_ATTEMPTS = 5;
/** Games in EACH of the two periods before the report compares recent with earlier play. */
export const PERIOD_GAMES = 7;
/** Points per attempt a category must lead the runner-up by before it is called highest-scoring. */
export const CATEGORY_LEAD = 5;
/** Average points per game the two periods must differ by before the report calls it "more" or "fewer". */
export const PERIOD_DIFFERENCE = 10;
/** Average potential points the two periods must differ by before windows are called wider or narrower. */
export const POTENTIAL_DIFFERENCE = 5;
/** Completed games before the report describes how spread out the totals are. */
export const MIN_CONSISTENCY_GAMES = 5;
/** A miss within this share of the whole scale is a near miss. */
export const NEAR_MISS_SHARE = 0.05;

export type Outcome = 'scoring-hit' | 'zero-catch' | 'miss' | 'timeout';

/** Risk bands by potential points of the saved window (the 100 · f² formula, see docs). */
export type RiskBand = 'conservative' | 'balanced' | 'high';
export const RISK_BANDS: readonly { id: RiskBand; label: string; min: number; max: number; widthNote: string }[] = [
  { id: 'conservative', label: 'Conservative', min: 0, max: 29, widthNote: 'window covers about 45% or more of the scale' },
  { id: 'balanced', label: 'Balanced', min: 30, max: 69, widthNote: 'window covers about 16% to 45% of the scale' },
  { id: 'high', label: 'High potential', min: 70, max: 100, widthNote: 'window covers about 16% or less of the scale' },
];
export const riskBandOf = (potential: number): RiskBand => RISK_BANDS.find((b) => potential <= b.max)!.id;

export function outcomeOf(r: RoundRecord): Outcome {
  if (r.timedOut) return 'timeout';
  if (!r.hit) return 'miss';
  return r.points > 0 ? 'scoring-hit' : 'zero-catch';
}

const TEAM_NAMES: ReadonlySet<string> = new Set(
  (franchises as { currentName: string; formerNames: string[] }[]).flatMap((f) => [f.currentName, ...f.formerNames]),
);
const HISTORIC_TEAMS: ReadonlySet<string> = new Set(['Philadelphia Warriors', 'Seattle SuperSonics', 'New Orleans Hornets', 'San Diego Clippers', 'Buffalo Braves', 'Kansas City Kings', 'Washington Bullets', 'Vancouver Grizzlies', 'Minneapolis Lakers', 'Syracuse Nationals', 'St. Louis Hawks', 'Cincinnati Royals']);

export type Focus = 'player' | 'team' | 'unknown';
/** Structured only: the first (most specific) subject in the question's metadata. No prompt parsing. */
export function focusOf(q: Question): Focus {
  const first = q.meta?.subjects[0];
  if (!first) return 'unknown';
  return TEAM_NAMES.has(first) || HISTORIC_TEAMS.has(first) ? 'team' : 'player';
}

export type Attempt = {
  readonly day: string;
  readonly round: number;
  readonly outcome: Outcome;
  readonly points: number;
  /** Points the saved window could have earned; null for a timeout (no window was chosen). */
  readonly potential: number | null;
  readonly nearMiss: boolean;
  readonly format: string;
  readonly era: string;
  readonly family: string;
  readonly focus: Focus;
};

const UNKNOWN = 'unknown';

export function attemptsOf(records: readonly EligibleRecord[]): Attempt[] {
  return records.flatMap((rec) => rec.rounds.map((r, i): Attempt => {
    const q = rec.slate.questions[i]!;
    const outcome = outcomeOf(r);
    let potential: number | null = null;
    if (outcome !== 'timeout') {
      try {
        potential = potentialPoints(q, { lo: r.lo, hi: r.hi });
      } catch {
        potential = null;
      }
    }
    return {
      day: rec.day,
      round: i + 1,
      outcome,
      points: r.points,
      potential,
      nearMiss: outcome === 'miss' && r.missBy <= (q.max - q.min) * NEAR_MISS_SHARE,
      format: q.meta ? formatOf(q) : 'recall',
      era: q.meta?.era ?? UNKNOWN,
      family: q.meta?.family ?? UNKNOWN,
      focus: focusOf(q),
    };
  }));
}

export type Tally = {
  readonly attempts: number;
  readonly scoringHits: number;
  readonly zeroCatches: number;
  readonly misses: number;
  readonly timeouts: number;
  readonly earned: number;
};
const EMPTY: Tally = { attempts: 0, scoringHits: 0, zeroCatches: 0, misses: 0, timeouts: 0, earned: 0 };
export const catches = (t: Tally) => t.scoringHits + t.zeroCatches;

export function tally(attempts: readonly Attempt[]): Tally {
  return attempts.reduce<Tally>((t, a) => ({
    attempts: t.attempts + 1,
    scoringHits: t.scoringHits + (a.outcome === 'scoring-hit' ? 1 : 0),
    zeroCatches: t.zeroCatches + (a.outcome === 'zero-catch' ? 1 : 0),
    misses: t.misses + (a.outcome === 'miss' ? 1 : 0),
    timeouts: t.timeouts + (a.outcome === 'timeout' ? 1 : 0),
    earned: t.earned + a.points,
  }), EMPTY);
}

export type BandStats = Tally & {
  readonly band: RiskBand;
  readonly potential: number;
  readonly nearMisses: number;
  /** Enough attempts to state a conclusion about this band. */
  readonly sufficient: boolean;
};

export type CategoryRow = Tally & {
  readonly key: string;
  readonly label: string;
  readonly perAttempt: number;
  readonly sufficient: boolean;
};

export type Dimension = 'format' | 'era' | 'family' | 'focus';

const FOCUS_LABEL: Record<Focus, string> = { player: 'Player questions', team: 'Team questions', unknown: 'No named subject' };
const prettify = (id: string) => id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function categoryLabel(dim: Dimension, key: string): string {
  if (key === UNKNOWN) return dim === 'era' ? 'Era not recorded' : dim === 'family' ? 'Category not recorded' : 'Not recorded';
  if (dim === 'focus') return FOCUS_LABEL[key as Focus];
  if (dim === 'era') return key === 'cross-era' ? 'Cross-era' : key === 'timeless' ? 'Timeless (rules)' : key;
  if (dim === 'format') return key === 'missing-point' ? 'Missing point' : prettify(key);
  return prettify(key);
}

export function categoryRows(attempts: readonly Attempt[], dim: Dimension): CategoryRow[] {
  const groups = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const key = a[dim];
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  return [...groups].map(([key, list]) => {
    const t = tally(list);
    return { ...t, key, label: categoryLabel(dim, key), perAttempt: t.earned / t.attempts, sufficient: t.attempts >= MIN_CATEGORY_ATTEMPTS };
  }).sort((a, b) => b.attempts - a.attempts || a.label.localeCompare(b.label));
}

/** The highest-scoring category, only when at least two have enough attempts and the lead is clear. */
export function topCategory(rows: readonly CategoryRow[]): CategoryRow | null {
  const ok = rows.filter((r) => r.sufficient && r.key !== UNKNOWN).sort((a, b) => b.perAttempt - a.perAttempt);
  return ok.length >= 2 && ok[0]!.perAttempt - ok[1]!.perAttempt >= CATEGORY_LEAD ? ok[0]! : null;
}

export type Period = { readonly games: number; readonly average: number; readonly potential: number | null };
export type Comparison = { readonly recent: Period; readonly earlier: Period };

const avg = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

/** Last PERIOD_GAMES completed games against the PERIOD_GAMES before them; null below 2 × PERIOD_GAMES. */
export function comparePeriods(records: readonly EligibleRecord[]): Comparison | null {
  if (records.length < PERIOD_GAMES * 2) return null;
  const period = (recs: readonly EligibleRecord[]): Period => {
    const pots = attemptsOf(recs).flatMap((a) => (a.potential === null ? [] : [a.potential]));
    return { games: recs.length, average: avg(recs.map((r) => r.total)), potential: pots.length ? avg(pots) : null };
  };
  return {
    recent: period(records.slice(-PERIOD_GAMES)),
    earlier: period(records.slice(-PERIOD_GAMES * 2, -PERIOD_GAMES)),
  };
}

export type Report = {
  readonly games: number;
  readonly stats: PlayerStats;
  readonly overall: Tally;
  readonly catchRate: number | null;
  readonly perAttempt: number | null;
  readonly bands: readonly BandStats[];
  readonly nearMisses: number;
  readonly comparison: Comparison | null;
  readonly dims: Readonly<Record<Dimension, readonly CategoryRow[]>>;
  /** Each game's total, oldest first, for the trend chart. */
  readonly series: readonly { day: string; total: number }[];
  readonly observations: readonly string[];
  /** The headline profile, each part null until the sample supports it. */
  readonly profile: Profile;
  /** Question format rows: the three player formats, and retired ones played earlier under their own names. */
  readonly formats: { readonly current: readonly CategoryRow[]; readonly earlier: readonly CategoryRow[] };
};

export type Profile = {
  /** Average over the last PERIOD_GAMES completed games, or all of them when fewer. */
  readonly recent: { readonly games: number; readonly average: number } | null;
  readonly caught: { readonly caught: number; readonly attempts: number };
  readonly best: { readonly day: string; readonly total: number } | null;
  /** The highest-scoring statistic category, only with enough attempts and a clear lead (topCategory). */
  readonly strongest: CategoryRow | null;
  /** Where most saved windows sit, by risk band. Needs MIN_CATEGORY_ATTEMPTS windows. */
  readonly risk: { readonly band: RiskBand; readonly label: string; readonly share: number; readonly windows: number } | null;
  /** The middle half of game totals (lower and upper quartile by rank). Needs MIN_CONSISTENCY_GAMES. */
  readonly consistency: { readonly low: number; readonly high: number; readonly games: number } | null;
  /** Recent against the comparable earlier period; null below 2 × PERIOD_GAMES games. */
  readonly trend: { readonly direction: 'more' | 'fewer' | 'same'; readonly points: number } | null;
};

function profileOf(records: readonly EligibleRecord[], overall: Tally, bands: readonly BandStats[], family: readonly CategoryRow[], comparison: Comparison | null): Profile {
  const recentRecs = records.slice(-PERIOD_GAMES);
  let best: Profile['best'] = null;
  for (const r of records) if (!best || r.total > best.total) best = { day: r.day, total: r.total };
  const windows = bands.reduce((n, b) => n + b.attempts, 0);
  const top = [...bands].sort((a, b) => b.attempts - a.attempts)[0];
  const sorted = records.map((r) => r.total).sort((a, b) => a - b);
  const q = (f: number, round: (n: number) => number) => sorted[round((sorted.length - 1) * f)]!;
  let trend: Profile['trend'] = null;
  if (comparison) {
    const diff = Math.round(comparison.recent.average - comparison.earlier.average);
    trend = { direction: Math.abs(diff) < PERIOD_DIFFERENCE ? 'same' : diff > 0 ? 'more' : 'fewer', points: Math.abs(diff) };
  }
  return {
    recent: recentRecs.length ? { games: recentRecs.length, average: Math.round(avg(recentRecs.map((r) => r.total))) } : null,
    caught: { caught: catches(overall), attempts: overall.attempts },
    best,
    strongest: topCategory(family),
    risk: top && windows >= MIN_CATEGORY_ATTEMPTS
      ? { band: top.band, label: RISK_BANDS.find((b) => b.id === top.band)!.label, share: top.attempts / windows, windows }
      : null,
    consistency: sorted.length >= MIN_CONSISTENCY_GAMES ? { low: q(0.25, Math.floor), high: q(0.75, Math.ceil), games: sorted.length } : null,
    trend,
  };
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function buildReport(records: readonly EligibleRecord[], today: string): Report {
  const attempts = attemptsOf(records);
  const overall = tally(attempts);
  const stats = playerStats(Object.fromEntries(records.map((r) => [r.day, { results: r.rounds, advanced: 5 }])), today);
  const bands = RISK_BANDS.map((b): BandStats => {
    const inBand = attempts.filter((a) => a.potential !== null && riskBandOf(a.potential) === b.id);
    const t = tally(inBand);
    return {
      ...t,
      band: b.id,
      potential: inBand.reduce((s, a) => s + (a.potential ?? 0), 0),
      nearMisses: inBand.filter((a) => a.nearMiss).length,
      sufficient: t.attempts >= MIN_CATEGORY_ATTEMPTS,
    };
  });
  const comparison = comparePeriods(records);
  const dims: Record<Dimension, CategoryRow[]> = {
    format: categoryRows(attempts, 'format'),
    era: categoryRows(attempts, 'era'),
    family: categoryRows(attempts, 'family'),
    focus: categoryRows(attempts, 'focus'),
  };

  const observations: string[] = [];
  const high = bands.find((b) => b.band === 'high')!;
  if (high.sufficient) observations.push(`Caught ${catches(high)} of ${n(high.attempts, 'high-potential attempt')}.`);
  const cons = bands.find((b) => b.band === 'conservative')!;
  if (high.sufficient && cons.sufficient) {
    const pct = (b: BandStats) => Math.round((catches(b) / b.attempts) * 100);
    observations.push(`Caught ${pct(cons)}% of conservative windows and ${pct(high)}% of high-potential windows.`);
  }
  for (const [dim, noun] of [['focus', 'category'], ['format', 'format'], ['era', 'era']] as const) {
    const top = topCategory(dims[dim]);
    if (top) observations.push(`${top.label} has been your highest-scoring ${noun} (${Math.round(top.perAttempt)} points per attempt over ${top.attempts} attempts).`);
  }
  if (comparison) {
    const diff = Math.round(comparison.recent.average - comparison.earlier.average);
    const gap = Math.abs(diff);
    observations.push(gap >= PERIOD_DIFFERENCE
      ? `Your last ${PERIOD_GAMES} completed games averaged ${gap} points ${diff > 0 ? 'more' : 'fewer'} than the ${PERIOD_GAMES} before them.`
      : `Your last ${PERIOD_GAMES} completed games averaged about the same as the ${PERIOD_GAMES} before them.`);
    const { recent, earlier } = comparison;
    if (recent.potential !== null && earlier.potential !== null && Math.abs(recent.potential - earlier.potential) >= POTENTIAL_DIFFERENCE) {
      observations.push(`Your recent windows were ${recent.potential > earlier.potential ? 'narrower' : 'wider'} on average (${Math.round(recent.potential)} potential points against ${Math.round(earlier.potential)}).`);
    }
  }

  return {
    games: records.length,
    stats,
    overall,
    catchRate: overall.attempts ? catches(overall) / overall.attempts : null,
    perAttempt: overall.attempts ? overall.earned / overall.attempts : null,
    bands,
    nearMisses: attempts.filter((a) => a.nearMiss).length,
    comparison,
    dims,
    series: records.map((r) => ({ day: r.day, total: r.total })),
    observations,
    profile: profileOf(records, overall, bands, dims.family, comparison),
    formats: {
      current: dims.format.filter((r) => isPlayerFormat(r.key)),
      earlier: dims.format.filter((r) => !isPlayerFormat(r.key)),
    },
  };
}
