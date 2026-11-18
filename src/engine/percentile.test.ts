import { describe, expect, it } from 'vitest';
import { emptyDistribution, MAX_TOTAL, midrankPercentile, ordinal, PERCENTILE_MIN_SAMPLE, percentileView } from './percentile';
import { MAX_TOTAL as SUMMARY_MAX } from './summary';

const dist = (scores: number[]) => {
  const d = emptyDistribution();
  for (const s of scores) d[s]! += 1;
  return d;
};

describe('midrank percentile', () => {
  it('matches the summary max', () => expect(MAX_TOTAL).toBe(SUMMARY_MAX));

  it('gives half credit to ties', () => {
    const d = dist([100, 200, 200, 300]);
    expect(midrankPercentile(d, 200)!.exact).toBe(50); // (1 + 0.5*2) / 4
    expect(midrankPercentile(d, 100)!.exact).toBe(12.5);
    expect(midrankPercentile(d, 300)!.exact).toBe(87.5);
  });

  it('handles 0 and 500 at the ends', () => {
    const d = dist([0, 250, 500]);
    expect(midrankPercentile(d, 0)!.rounded).toBe(17);
    expect(midrankPercentile(d, 500)!.rounded).toBe(83);
  });

  it('an all-tied population puts everyone at the 50th', () => {
    expect(midrankPercentile(dist([321, 321, 321, 321]), 321)!.exact).toBe(50);
  });

  it('a lone player is the 50th, a two-player population is 25th and 75th', () => {
    expect(midrankPercentile(dist([180]), 180)!.exact).toBe(50);
    const two = dist([100, 400]);
    expect(midrankPercentile(two, 100)!.exact).toBe(25);
    expect(midrankPercentile(two, 400)!.exact).toBe(75);
  });

  it('returns null for an empty population, a bad score or a malformed distribution', () => {
    expect(midrankPercentile(emptyDistribution(), 100)).toBeNull();
    expect(midrankPercentile(dist([1]), 501)).toBeNull();
    expect(midrankPercentile(dist([1]), -1)).toBeNull();
    expect(midrankPercentile(dist([1]), 1.5)).toBeNull();
    expect(midrankPercentile([1, 2, 3], 1)).toBeNull();
  });
});

describe('ordinal', () => {
  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [82, '82nd'], [100, '100th'], [0, '0th'],
  ])('%i → %s', (n, s) => expect(ordinal(n)).toBe(s));
});

describe('percentileView (what the results screen may claim)', () => {
  it('never shows a percentile below the sample gate', () => {
    const d = dist(Array.from({ length: PERCENTILE_MIN_SAMPLE - 1 }, (_, i) => i));
    expect(percentileView({ counts: d, n: PERCENTILE_MIN_SAMPLE - 1, score: 50 })).toMatchObject({ kind: 'gathering', n: 99 });
  });

  it('crossing the gate shows "Xth percentile today" with the sample size, never "beat X%"', () => {
    const d = dist(Array.from({ length: 214 }, (_, i) => i));
    const v = percentileView({ counts: d, n: 214, score: 176 });
    expect(v.kind).toBe('ready');
    if (v.kind !== 'ready') return;
    expect(v.label).toBe('82nd percentile today');
    expect(v.detail).toBe('based on 214 eligible completed games');
    expect(`${v.label} ${v.detail}`).not.toMatch(/beat/i);
  });

  it('is unavailable without data', () => {
    expect(percentileView(null).kind).toBe('unavailable');
  });
});
