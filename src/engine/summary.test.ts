import { describe, expect, it } from 'vitest';
import { playerStats, shareText, verdict } from './summary';

const run = (points: number[]) => ({
  results: points.map((p, i) => ({ questionId: `q${i}`, lo: 0, hi: 1, hit: p > 0, points: p, missBy: p > 0 ? 0 : 3 })),
  advanced: points.length,
});

describe('shareText', () => {
  it('is spoiler-free: puzzle number, total, one mark per round, and the link', () => {
    const text = shareText({ number: 3, results: run([100, 83, 0, 45, 12]).results, url: 'https://statwindow.vercel.app' });
    expect(text).toBe(['Stat Window No. 3  240/500', '🟩🟩⬛🟨🟧' /* taste-skill-ignore */, 'https://statwindow.vercel.app'].join('\n'));
  });
});

describe('verdict', () => {
  it('names the run by its total', () => {
    expect(verdict(450)).toMatch(/\w/);
    expect(verdict(0)).not.toBe(verdict(450));
  });
});

describe('playerStats', () => {
  it('counts only completed daily runs', () => {
    const s = playerStats({ '2026-11-15': run([10, 10, 10, 10, 10]), '2026-11-16': run([10]) }, '2026-11-16');
    expect(s.played).toBe(1);
    expect(s.best).toBe(50);
    expect(s.average).toBe(50);
  });
  it('keeps a streak alive through today if yesterday was completed', () => {
    const runs = {
      '2026-11-15': run([1, 1, 1, 1, 1]),
      '2026-11-16': run([1, 1, 1, 1, 1]),
    };
    expect(playerStats(runs, '2026-11-17').streak).toBe(2);
    expect(playerStats(runs, '2026-11-18').streak).toBe(0);
  });
  it('tracks the longest streak', () => {
    const runs = {
      '2026-11-15': run([1, 1, 1, 1, 1]),
      '2026-11-16': run([1, 1, 1, 1, 1]),
      '2026-11-17': run([1, 1, 1, 1, 1]),
      '2026-11-19': run([1, 1, 1, 1, 1]),
    };
    const s = playerStats(runs, '2026-11-19');
    expect(s.streak).toBe(1);
    expect(s.longest).toBe(3);
  });
  it('buckets completed days by total, 100 points per bucket, with 500 in the top bucket', () => {
    const runs = {
      '2026-11-15': run([0, 0, 0, 0, 0]),
      '2026-11-16': run([20, 20, 20, 20, 19]),
      '2026-11-17': run([20, 20, 20, 20, 20]),
      '2026-11-18': run([100, 100, 100, 100, 100]),
      '2026-11-19': run([90, 90, 90, 90, 90]),
      '2026-11-20': run([10]),
    };
    expect(playerStats(runs, '2026-11-20').distribution).toEqual([2, 1, 0, 0, 2]);
  });
});
