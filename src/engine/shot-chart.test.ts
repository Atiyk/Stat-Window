import { describe, expect, it } from 'vitest';
import type { Slate } from '../content/schema';
import { COURT, HOOP } from './court';
import type { RoundRecord } from './game';
import { scoreWindow, type Window } from './scoring';
import { buildShotChart, shotDistance, SHOT_MARKER_RADIUS, SHOT_UNSUBMITTED_DIVIDER, type ShotAttempt } from './shot-chart';

const slate: Slate = {
  date: '2026-11-24',
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `private-question-${index + 1}`,
    sport: 'NBA',
    prompt: 'A hidden question prompt',
    context: 'A hidden question context',
    answer: 73,
    unit: { singular: 'point', plural: 'points' },
    min: 0,
    max: 100,
    step: 1,
    note: 'A hidden answer explanation',
    source: { name: 'Example', quote: '73 points', url: 'https://example.com/' },
    verified: { on: '2026-11-01', by: 'Test' },
  })),
};

function round(index: number, window: Window, day = slate): RoundRecord {
  const question = day.questions[index]!;
  return { questionId: question.id, ...window, ...scoreWindow(question, window) };
}

function distance(attempt: ShotAttempt): number {
  return Math.hypot(attempt.x - HOOP.x, attempt.y - HOOP.y);
}

describe('buildShotChart', () => {
  it('plots a narrow miss farther away than a wide scoring window', () => {
    const [narrowMiss, wideHit, narrowHit] = buildShotChart(slate, [
      round(0, { lo: 32, hi: 33 }),
      round(1, { lo: 25, hi: 75 }),
      round(2, { lo: 72, hi: 73 }),
    ]);
    expect(narrowMiss).toMatchObject({ potential: 100, earned: 0, outcome: 'missed' });
    expect(wideHit).toMatchObject({ potential: 26, earned: 26, outcome: 'made' });
    expect(narrowHit).toMatchObject({ potential: 100, earned: 100, outcome: 'made' });
    expect(distance(narrowMiss!)).toBeGreaterThan(distance(wideHit!));
    expect(distance(narrowMiss!)).toBeCloseTo(distance(narrowHit!));
  });

  it('keeps the distance strictly increasing with potential points across the court', () => {
    const wideSlate = {
      ...slate,
      questions: slate.questions.map((question) => ({ ...question, max: 400 })),
    };
    let lastPotential = -1;
    let lastDistance = -1;
    for (let width = 400; width >= 1; width--) {
      const attempts = buildShotChart(wideSlate, wideSlate.questions.map((_, index) => round(index, { lo: 0, hi: width }, wideSlate)));
      const potential = attempts[0]!.potential!;
      const radius = distance(attempts[0]!);
      if (potential > lastPotential) expect(radius).toBeGreaterThan(lastDistance);
      for (const attempt of attempts) {
        expect(distance(attempt)).toBeCloseTo(radius);
        expect(attempt.x - SHOT_MARKER_RADIUS).toBeGreaterThan(SHOT_UNSUBMITTED_DIVIDER);
        expect(attempt.x + SHOT_MARKER_RADIUS).toBeLessThanOrEqual(COURT.length);
        expect(attempt.y - SHOT_MARKER_RADIUS).toBeGreaterThanOrEqual(0);
        expect(attempt.y + SHOT_MARKER_RADIUS).toBeLessThanOrEqual(COURT.width);
      }
      lastPotential = potential;
      lastDistance = radius;
    }
  });

  it('gives equal-risk attempts stable, separate numbered markers', () => {
    const rounds = slate.questions.map((_, index) => round(index, { lo: 0, hi: 100 }));
    const attempts = buildShotChart(slate, rounds);
    expect(attempts.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5]);
    expect(attempts).toEqual(buildShotChart(slate, rounds));
    for (const [index, attempt] of attempts.entries()) {
      for (const other of attempts.slice(index + 1)) {
        expect(Math.hypot(attempt.x - other.x, attempt.y - other.y)).toBeGreaterThan(2 * SHOT_MARKER_RADIUS);
      }
    }
  });

  it('keeps timeouts off the risk axis and distinguishes a zero-point catch', () => {
    const caught = round(0, { lo: 0, hi: 99 });
    const missed = round(1, { lo: 0, hi: 72 });
    const timeout = { ...round(2, { lo: 0, hi: 100 }), hit: false, timedOut: true };
    const [zero, miss, expired] = buildShotChart(slate, [caught, missed, timeout]);
    expect(zero).toMatchObject({ potential: 0, earned: 0, outcome: 'zero' });
    expect(miss).toMatchObject({ earned: 0, outcome: 'missed' });
    expect(expired).toMatchObject({ potential: null, earned: 0, outcome: 'timeout' });
    expect(expired!.x + SHOT_MARKER_RADIUS).toBeLessThan(SHOT_UNSUBMITTED_DIVIDER);
    expect(expired!.x - SHOT_MARKER_RADIUS).toBeGreaterThan(0);
  });

  it('keeps legacy scores and derives decimal risk without copying hidden inputs', () => {
    const decimalSlate = {
      ...slate,
      questions: slate.questions.map((question) => ({ ...question, min: 9.4, max: 10.2, step: 0.01, answer: 9.58 })),
    };
    const hit = round(0, { lo: 9.57, hi: 9.58 }, decimalSlate);
    const wrongQuestion = { ...round(1, { lo: 9.57, hi: 9.58 }, decimalSlate), questionId: 'stale' };
    const invalidWindow = { ...round(2, { lo: 9.57, hi: 9.58 }, decimalSlate), lo: 12 };
    const [attempt, changed, invalid] = buildShotChart(decimalSlate, [hit, wrongQuestion, invalidWindow]);
    expect(attempt).toMatchObject({ potential: 100, earned: 100, outcome: 'made' });
    expect(changed).toMatchObject({ potential: null, earned: 100, outcome: 'unavailable' });
    expect(invalid).toMatchObject({ potential: null, earned: 100, outcome: 'unavailable' });
    expect(hit).toMatchObject({ lo: 9.57, hi: 9.58, points: 100 });
    for (const hidden of ['answer', 'prompt', 'source', 'questionId', 'lo', 'hi']) {
      expect(attempt).not.toHaveProperty(hidden);
    }
    expect(JSON.stringify(attempt)).not.toContain('9.58');
  });

  it('never overlaps two submitted shots, whatever each window was worth', () => {
    const widths = [1, 5, 12, 25, 40, 60, 80, 99];
    for (const a of widths) for (const b of widths) {
      const attempts = buildShotChart(slate, [a, b, a, b, a].map((w, i) => round(i, { lo: 0, hi: w })));
      for (const [i, one] of attempts.entries()) {
        for (const other of attempts.slice(i + 1)) {
          expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThan(2 * SHOT_MARKER_RADIUS);
        }
      }
    }
  });

  it('puts a 100-point window beyond the three-point line and a 0-point window close to the rim', () => {
    expect(shotDistance(100)).toBeGreaterThan(COURT.threePointRadius);
    expect(shotDistance(0)).toBeLessThanOrEqual(COURT.freeThrowCircleRadius + 1);
  });
});
