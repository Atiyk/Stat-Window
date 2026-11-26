import { describe, expect, it } from 'vitest';
import { buildHistory, type EligibleRecord } from './history';
import {
  attemptsOf, buildReport, categoryLabel, categoryRows, catches, comparePeriods, focusOf, outcomeOf, riskBandOf, tally, topCategory,
  MIN_CATEGORY_ATTEMPTS, PERIOD_GAMES, RISK_BANDS,
} from './scouting';
import { testRun, testSlate, type Pick } from './test-fixtures';
import { addDays } from './daily';

const S1 = { launchDay: '2026-11-30' };

/** Eligible records for consecutive days from the launch, with per-day picks and metadata. */
function records(count: number, picks: (i: number) => Pick[] = () => Array(5).fill([63, 83]), meta: (i: number) => Parameters<typeof testSlate>[1] = () => []): EligibleRecord[] {
  const days = Array.from({ length: count }, (_, i) => addDays('2026-11-30', i));
  const slates = Object.fromEntries(days.map((d, i) => [d, testSlate(d, meta(i))]));
  const runs = Object.fromEntries(days.map((d, i) => [d, testRun(slates[d]!, picks(i))]));
  return buildHistory(runs, 's1', S1, addDays('2026-11-30', count), slates).records as EligibleRecord[];
}

describe('outcomes', () => {
  it('separates scoring hits, zero-point catches, misses and timeouts', () => {
    const recs = records(1, () => [[73, 74], [0, 100], [0, 10], 'timeout', [60, 90]]);
    expect(recs[0]!.rounds.map(outcomeOf)).toEqual(['scoring-hit', 'zero-catch', 'miss', 'timeout', 'scoring-hit']);
    const t = tally(attemptsOf(recs));
    expect(t).toMatchObject({ attempts: 5, scoringHits: 2, zeroCatches: 1, misses: 1, timeouts: 1 });
    expect(catches(t)).toBe(3);
  });

  it('a timeout carries no window, so it has no potential and sits in no risk band', () => {
    const a = attemptsOf(records(1, () => ['timeout', 'timeout', 'timeout', 'timeout', 'timeout']));
    expect(a.every((x) => x.potential === null)).toBe(true);
    const r = buildReport(records(1, () => ['timeout', 'timeout', 'timeout', 'timeout', 'timeout']), '2026-12-01');
    expect(r.bands.every((b) => b.attempts === 0)).toBe(true);
    expect(r.overall.timeouts).toBe(5);
    expect(r.catchRate).toBe(0);
    expect(r.perAttempt).toBe(0);
  });
});

describe('risk bands', () => {
  it('uses the potential-points boundaries at 30 and 70', () => {
    expect([0, 29].map(riskBandOf)).toEqual(['conservative', 'conservative']);
    expect([30, 69].map(riskBandOf)).toEqual(['balanced', 'balanced']);
    expect([70, 100].map(riskBandOf)).toEqual(['high', 'high']);
    expect(RISK_BANDS.map((b) => [b.min, b.max])).toEqual([[0, 29], [30, 69], [70, 100]]);
  });

  it('reconstructs potential from the saved window on its own scale', () => {
    // On a 100-step scale a 1-step window is worth 100, a 17-step window ~70, a 46-step window ~30.
    const a = attemptsOf(records(1, () => [[73, 74], [64, 81], [50, 96], [0, 100], [60, 70]]));
    expect(a.map((x) => x.potential)).toEqual([100, 70, 30, 0, 83]);
    expect(a.map((x) => riskBandOf(x.potential!))).toEqual(['high', 'high', 'balanced', 'conservative', 'high']);
  });

  it('compares earned with potential and counts near misses', () => {
    const r = buildReport(records(2, () => [[73, 74], [73, 74], [74, 75], [76, 77], [10, 20]]), '2026-12-02');
    const high = r.bands.find((b) => b.band === 'high')!;
    expect(high.attempts).toBe(10);
    expect(catches(high)).toBe(4);
    expect(high.earned).toBe(400);
    expect(high.potential).toBe(966);
    expect(high.nearMisses).toBe(4); // answer 73 vs windows missing by 1 or 3 (within 5% of a 100 scale)
    expect(r.nearMisses).toBe(4);
  });

  it('draws no conclusion about a band under the minimum sample', () => {
    const small = buildReport(records(1, () => Array(4).fill([73, 74]).concat([[0, 100]])), '2026-12-01');
    expect(small.bands.find((b) => b.band === 'high')!.sufficient).toBe(false);
    expect(small.observations.join(' ')).not.toMatch(/high-potential/);
    const enough = buildReport(records(2, () => Array(5).fill([73, 74])), '2026-12-02');
    expect(enough.observations).toContain('Caught 10 of 10 high-potential attempts.');
  });
});

describe('knowledge profile', () => {
  const metaFor = (i: number) => (i % 2 === 0
    ? [{ format: 'recall' as const, era: '1990s', family: 'points-game', subjects: ['Michael Jordan'] }, { format: 'ratio' as const, era: 'cross-era', family: 'shooting-pct', subjects: ['Boston Celtics'] }]
    : []);

  it('groups by structured metadata and treats missing metadata as unknown, never by guessing', () => {
    const recs = records(2, undefined, metaFor);
    const a = attemptsOf(recs);
    // Day 1: questions 1 and 2 have metadata; questions 3-5 have none. Day 2 has none at all.
    expect(a.filter((x) => x.era === 'unknown')).toHaveLength(8);
    expect(a.filter((x) => x.focus === 'unknown')).toHaveLength(8);
    expect(a.filter((x) => x.focus === 'player')).toHaveLength(1);
    expect(a.filter((x) => x.focus === 'team')).toHaveLength(1);
    const eras = categoryRows(a, 'era').map((r) => r.label);
    expect(eras).toContain('Era not recorded');
    expect(eras).toContain('Cross-era');
    expect(categoryLabel('format', 'missing-point')).toBe('Missing point');
    expect(categoryLabel('era', 'timeless')).toBe('Timeless (rules)');
  });

  it('classifies team vs player from the first subject, including former franchise names', () => {
    const q = (subjects: string[]) => ({ meta: { format: 'recall', family: 'x', era: '2010s', subjects, supports: [] } }) as never;
    expect(focusOf(q(['Seattle SuperSonics']))).toBe('team');
    expect(focusOf(q(['New Jersey Nets']))).toBe('team');
    expect(focusOf(q(['Stephen Curry', 'Golden State Warriors']))).toBe('player');
    expect(focusOf(q([]))).toBe('unknown');
    expect(focusOf({} as never)).toBe('unknown');
  });

  it('marks small samples and names a top category only with two sufficient ones and a clear lead', () => {
    const rows = (spec: [string, number, number][]) => categoryRows(spec.flatMap(([era, n, pts]) =>
      Array.from({ length: n }, () => ({ era, points: pts, outcome: pts ? 'scoring-hit' : 'miss' }) as never)), 'era');
    expect(MIN_CATEGORY_ATTEMPTS).toBe(5);
    expect(topCategory(rows([['2010s', 4, 90], ['1990s', 9, 10]]))).toBeNull(); // one under-sampled category
    expect(topCategory(rows([['2010s', 6, 50], ['1990s', 9, 48]]))).toBeNull(); // lead under the margin
    expect(topCategory(rows([['2010s', 6, 60], ['1990s', 9, 40]]))?.key).toBe('2010s');
    expect(topCategory(rows([['unknown', 6, 90], ['1990s', 9, 10], ['2000s', 5, 5]]))?.key).toBe('1990s'); // unknown is never "the best"
  });
});

describe('recent versus earlier', () => {
  it('needs seven games in each period', () => {
    expect(PERIOD_GAMES).toBe(7);
    expect(comparePeriods(records(13))).toBeNull();
    expect(buildReport(records(13), '2026-12-20').comparison).toBeNull();
    expect(comparePeriods(records(14))).not.toBeNull();
  });

  it('says "more" only for a clear difference and never claims skill', () => {
    const steady = buildReport(records(14), '2026-12-20');
    expect(steady.observations.join(' ')).toContain('about the same as the 7 before them');
    const better = buildReport(records(14, (i) => Array(5).fill(i < 7 ? [0, 100] : [63, 83])), '2026-12-20');
    const line = better.observations.find((o) => o.startsWith('Your last 7'))!;
    expect(line).toMatch(/averaged \d+ points more than the 7 before them\./);
    expect(better.observations.join(' ')).not.toMatch(/improv|better|skill|learn/i);
    const worse = buildReport(records(14, (i) => Array(5).fill(i < 7 ? [63, 83] : [0, 100])), '2026-12-20');
    expect(worse.observations.find((o) => o.startsWith('Your last 7'))).toMatch(/fewer/);
  });

  it('describes window width only when potential differs by 5 or more', () => {
    const r = buildReport(records(14, (i) => Array(5).fill(i < 7 ? [0, 100] : [73, 74])), '2026-12-20');
    expect(r.observations.join(' ')).toMatch(/recent windows were narrower on average/);
  });
});

describe('report basics', () => {
  it('handles no history', () => {
    const r = buildReport([], '2026-12-01');
    expect(r.games).toBe(0);
    expect(r.catchRate).toBeNull();
    expect(r.perAttempt).toBeNull();
    expect(r.observations).toEqual([]);
    expect(r.stats.played).toBe(0);
  });

  it('reuses the shared stats for streaks, average and best', () => {
    const r = buildReport(records(3, (i) => (i === 1 ? Array(5).fill([73, 74]) : Array(5).fill([63, 83]))), '2026-12-02');
    expect(r.stats).toMatchObject({ played: 3, best: 500, streak: 3, longest: 3 });
    expect(r.series).toHaveLength(3);
    expect(r.perAttempt).toBeCloseTo(r.overall.earned / 15);
  });
});
