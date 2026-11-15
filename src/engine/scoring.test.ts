import { describe, expect, it } from 'vitest';
import { scoreWindow, potentialPoints, isHit } from './scoring';

// Worked examples come from the scoring spec in docs/SCORING.md, not from the implementation.
const q = { min: 0, max: 100, step: 1, answer: 73 };

describe('isHit (inclusive on both ends)', () => {
  it('counts the answer sitting exactly on the low edge as a hit', () => {
    expect(isHit(q, { lo: 73, hi: 80 })).toBe(true);
  });
  it('counts the answer sitting exactly on the high edge as a hit', () => {
    expect(isHit(q, { lo: 60, hi: 73 })).toBe(true);
  });
  it('misses when the answer is one step outside', () => {
    expect(isHit(q, { lo: 74, hi: 90 })).toBe(false);
    expect(isHit(q, { lo: 50, hi: 72 })).toBe(false);
  });
});

describe('potentialPoints', () => {
  it('is 0 for the full range', () => {
    expect(potentialPoints(q, { lo: 0, hi: 100 })).toBe(0);
  });
  it('is 100 for the tightest legal window (one step wide)', () => {
    expect(potentialPoints(q, { lo: 72, hi: 73 })).toBe(100);
  });
  it('follows the squared curve: half the range is worth 26', () => {
    // ((100-50)/(100-1))^2 = 0.2551 -> 26
    expect(potentialPoints(q, { lo: 25, hi: 75 })).toBe(26);
  });
  it('a tenth of the range is worth 83', () => {
    // (90/99)^2 = 0.82645 -> 83
    expect(potentialPoints(q, { lo: 70, hi: 80 })).toBe(83);
  });
  it('is never negative and never exceeds 100', () => {
    for (let w = 1; w <= 100; w++) {
      const p = potentialPoints(q, { lo: 0, hi: w });
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
  it('never rewards a wider window more than a narrower one', () => {
    let prev = Infinity;
    for (let w = 1; w <= 100; w++) {
      const p = potentialPoints(q, { lo: 0, hi: w });
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
  it('scales to the question range, so big-number questions are fair', () => {
    const big = { min: 20000, max: 50000, step: 100, answer: 38387 };
    // 20% of either range is worth about the same (within a point of rounding).
    const a = potentialPoints(big, { lo: 35000, hi: 41000 });
    const b = potentialPoints(q, { lo: 40, hi: 60 });
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });
});

describe('scoreWindow', () => {
  it('awards the potential on a hit', () => {
    expect(scoreWindow(q, { lo: 70, hi: 80 })).toEqual({ hit: true, points: 83, missBy: 0 });
  });
  it('awards 0 on a miss and reports the distance to the nearest edge', () => {
    expect(scoreWindow(q, { lo: 50, hi: 66 })).toEqual({ hit: false, points: 0, missBy: 7 });
    expect(scoreWindow(q, { lo: 80, hi: 90 })).toEqual({ hit: false, points: 0, missBy: 7 });
  });
  it('handles decimal steps without floating-point drift', () => {
    const bolt = { min: 9.4, max: 10.2, step: 0.01, answer: 9.58 };
    expect(scoreWindow(bolt, { lo: 9.58, hi: 9.59 })).toEqual({ hit: true, points: 100, missBy: 0 });
    expect(scoreWindow(bolt, { lo: 9.5, hi: 9.57 }).missBy).toBe(0.01);
  });
  it('rejects windows that are inverted, too narrow, or out of bounds', () => {
    expect(() => scoreWindow(q, { lo: 80, hi: 70 })).toThrow();
    expect(() => scoreWindow(q, { lo: 73, hi: 73 })).toThrow();
    expect(() => scoreWindow(q, { lo: -5, hi: 20 })).toThrow();
    expect(() => scoreWindow(q, { lo: 10, hi: 101 })).toThrow();
  });
});
