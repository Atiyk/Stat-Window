import { describe, expect, it, vi } from 'vitest';
import type { Slate } from '../content/schema';
import { finalShot, verifiedDailyRounds, verifiedPreviousBest } from './final-shot';
import { normalizeWindow, totalPoints } from './game';
import { scoreWindow } from './scoring';
import { BETA } from './season';

function slate(date: string): Slate {
  return {
    date,
    questions: Array.from({ length: 5 }, (_, index) => ({
      id: `${date}-${index}`,
      sport: 'NBA',
      prompt: 'How many points?',
      context: 'Test slate',
      answer: 73,
      unit: { singular: 'point', plural: 'points' },
      min: 0,
      max: 100,
      step: 1,
      note: 'Test answer',
      source: { name: 'Test source', quote: '73 points', url: 'https://example.com' },
      verified: { on: '2026-11-15', by: 'Test' },
    })),
  };
}

function run(day: Slate, width: number) {
  return {
    advanced: 5,
    results: day.questions.map((question) => {
      const window = normalizeWindow(question, { lo: 73 - Math.floor(width / 2), hi: 73 + Math.ceil(width / 2) });
      return { questionId: question.id, ...window, ...scoreWindow(question, window) };
    }),
  };
}

describe('finalShot', () => {
  it('targets strictly beating a verified previous best and respects the scored round maximum', () => {
    expect(finalShot(260, 194)).toEqual({ kind: 'target', points: 67 });
    expect(finalShot(299, 200)).toEqual({ kind: 'target', points: 100 });
    expect(finalShot(200, 200)).toEqual({ kind: 'target', points: 1 });
    expect(finalShot(0, 0)).toEqual({ kind: 'target', points: 1 });
    expect(finalShot(300, 200)).toBeNull();
    expect(finalShot(null, 194)).toBeNull();
  });

  it('recognizes an already-secured record', () => {
    expect(finalShot(260, 261)).toEqual({ kind: 'surpassed' });
  });
});

describe('verified personal best', () => {
  it('picks the highest valid prior score from completed official runs in the same season', async () => {
    const days = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
    const slates = Object.fromEntries(days.map((day) => [day, slate(day)]));
    const loadSlate = vi.fn(async (day: string) => slates[day] ?? null);
    const best = run(slates['2026-11-21']!, 35);
    const stale = run(slates['2026-11-22']!, 1);
    stale.results[0] = { ...stale.results[0]!, questionId: 'different-question' };
    const runs = {
      '2026-02-30': run(slate('2026-02-30'), 1),
      '2026-11-19': run(slates['2026-11-19']!, 1),
      '2026-11-20': run(slates['2026-11-20']!, 55),
      '2026-11-21': best,
      '2026-11-22': stale,
      '2026-11-23': { ...run(slates['2026-11-23']!, 1), advanced: 4 },
      '2026-11-24': run(slates['2026-11-24']!, 1),
    };

    await expect(verifiedPreviousBest(runs, '2026-11-24', { launchDay: '2026-11-20' }, loadSlate))
      .resolves.toBe(totalPoints(best.results));
    expect(loadSlate.mock.calls).toEqual([['2026-11-22'], ['2026-11-21']]);
  });

  it('rejects wrong stored scores and off-grid windows without mutating the run', async () => {
    const day = slate('2026-11-23');
    const bad = run(day, 1);
    bad.results[0] = { ...bad.results[0]!, points: 99 };
    bad.results[1] = { ...bad.results[1]!, lo: 72.4 };
    const original = structuredClone(bad);
    await expect(verifiedPreviousBest({ [day.date]: bad }, '2026-11-24', BETA, async () => day)).resolves.toBeNull();
    expect(bad).toEqual(original);
    expect(verifiedDailyRounds(day, bad.results.slice(1))).toBe(false);
  });

  it('recognizes correct timeouts and legacy full-window catches with zero points', () => {
    const day = slate('2026-11-15');
    const question = day.questions[0]!;
    const window = { lo: question.min, hi: question.max };
    const fullWindow = { questionId: question.id, ...window, ...scoreWindow(question, window) };
    const timeout = { ...fullWindow, hit: false, timedOut: true };
    expect(verifiedDailyRounds(day, [fullWindow])).toBe(true);
    expect(verifiedDailyRounds(day, [timeout])).toBe(true);
    expect(verifiedDailyRounds(day, [{ ...timeout, hi: question.max - 1 }])).toBe(false);
  });
});
