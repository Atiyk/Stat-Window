import { describe, expect, it } from 'vitest';
import { canLock, initGame, gameReducer, normalizeWindow, totalPoints, type GameState } from './game';
import type { Slate } from '../content/schema';

const q = (id: string, answer: number, min = 0, max = 100, step = 1) => ({
  id, sport: 'Basketball', prompt: 'How many games did they win?', context: 'NBA', answer,
  unit: { singular: 'win', plural: 'wins' }, min, max, step, note: 'n',
  source: { name: 'W', url: 'https://w.org', quote: String(answer) },
  verified: { on: '2026-11-15', by: 'E' },
});
const slate: Slate = {
  date: '2026-11-15',
  questions: [q('a', 73), q('b', 10), q('c', 50), q('d', 99), q('e', 1)],
};

function play(state: GameState, lo: number, hi: number): GameState {
  let s = gameReducer(state, { type: 'setWindow', window: { lo, hi } });
  s = gameReducer(s, { type: 'lock' });
  s = gameReducer(s, { type: 'settle' });
  return s;
}

describe('normalizeWindow', () => {
  const scale = { min: 0, max: 100, step: 5 };
  it('snaps to the step grid', () => {
    expect(normalizeWindow(scale, { lo: 12, hi: 38 })).toEqual({ lo: 10, hi: 40 });
  });
  it('clamps to the scale', () => {
    expect(normalizeWindow(scale, { lo: -40, hi: 400 })).toEqual({ lo: 0, hi: 100 });
  });
  it('stops the moving low handle one step before the high handle', () => {
    expect(normalizeWindow(scale, { lo: 80, hi: 50 }, 'lo')).toEqual({ lo: 45, hi: 50 });
  });
  it('stops the moving high handle one step after the low handle', () => {
    expect(normalizeWindow(scale, { lo: 50, hi: 20 }, 'hi')).toEqual({ lo: 50, hi: 55 });
  });
  it('keeps a one-step window legal at the very edges', () => {
    expect(normalizeWindow(scale, { lo: 100, hi: 100 }, 'lo')).toEqual({ lo: 95, hi: 100 });
    expect(normalizeWindow(scale, { lo: 0, hi: 0 }, 'hi')).toEqual({ lo: 0, hi: 5 });
  });
});

describe('a daily run', () => {
  it('starts on round 1 with the full range selected (worth 0)', () => {
    const s = initGame(slate, 'daily', []);
    expect(s.phase).toBe('ready');
    expect(s.round).toBe(0);
    expect(s.window).toEqual({ lo: 0, hi: 100 });
  });

  it('moves ready → adjusting → locked → resolved → next round', () => {
    let s = initGame(slate, 'daily', []);
    s = gameReducer(s, { type: 'setWindow', window: { lo: 70, hi: 80 } });
    expect(s.phase).toBe('adjusting');
    s = gameReducer(s, { type: 'lock' });
    expect(s.phase).toBe('locked');
    expect(s.results).toEqual([{ questionId: 'a', lo: 70, hi: 80, hit: true, points: 83, missBy: 0 }]);
    s = gameReducer(s, { type: 'reveal' });
    expect(s.phase).toBe('revealing');
    s = gameReducer(s, { type: 'settle' });
    expect(s.phase).toBe('resolved');
    s = gameReducer(s, { type: 'next' });
    expect(s.phase).toBe('ready');
    expect(s.round).toBe(1);
    expect(s.window).toEqual({ lo: 0, hi: 100 });
  });

  it('refuses to lock the untouched full range (it can only ever score 0)', () => {
    const s = initGame(slate, 'daily', []);
    expect(gameReducer(s, { type: 'lock' })).toBe(s);
    expect(canLock(s)).toBe(false);
    const narrowed = gameReducer(s, { type: 'setWindow', window: { lo: 1, hi: 100 } });
    expect(canLock(narrowed)).toBe(true);
  });

  it('ignores window changes and double locks once locked', () => {
    let s = initGame(slate, 'daily', []);
    s = gameReducer(s, { type: 'setWindow', window: { lo: 70, hi: 80 } });
    s = gameReducer(s, { type: 'lock' });
    const again = gameReducer(gameReducer(s, { type: 'setWindow', window: { lo: 0, hi: 1 } }), { type: 'lock' });
    expect(again.results).toHaveLength(1);
    expect(again.window).toEqual({ lo: 70, hi: 80 });
  });

  it('records a miss with zero points and the miss distance', () => {
    let s = initGame(slate, 'daily', []);
    s = play(s, 50, 60);
    expect(s.results[0]).toEqual({ questionId: 'a', lo: 50, hi: 60, hit: false, points: 0, missBy: 13 });
  });

  it('completes after five rounds and totals the points', () => {
    let s = initGame(slate, 'daily', []);
    const windows: [number, number][] = [[72, 73], [0, 99], [40, 60], [90, 95], [0, 2]];
    windows.forEach(([lo, hi], i) => {
      s = play(s, lo, hi);
      if (i < 4) s = gameReducer(s, { type: 'next' });
    });
    s = gameReducer(s, { type: 'next' });
    expect(s.phase).toBe('complete');
    // 100 (one step wide) + 0 (99 of 100 steps) + 65 (20 wide) + 0 (miss) + 98 (2 wide)
    expect(s.results.map((r) => r.points)).toEqual([100, 0, 65, 0, 98]);
    expect(totalPoints(s.results)).toBe(263);
  });
});

describe('resuming', () => {
  it('reopens a round that was locked but whose result was never viewed', () => {
    const s = initGame(slate, 'daily', [{ questionId: 'a', lo: 70, hi: 80, hit: true, points: 83, missBy: 0 }], 0);
    expect(s.phase).toBe('resolved');
    expect(s.round).toBe(0);
    expect(s.window).toEqual({ lo: 70, hi: 80 });
  });
  it('resumes at the first unplayed round', () => {
    const s = initGame(slate, 'daily', [
      { questionId: 'a', lo: 70, hi: 80, hit: true, points: 83, missBy: 0 },
      { questionId: 'b', lo: 0, hi: 20, hit: true, points: 64, missBy: 0 },
    ], 2);
    expect(s.phase).toBe('ready');
    expect(s.round).toBe(2);
  });
  it('opens straight to the results when all five are saved', () => {
    const results = slate.questions.map((x) => ({ questionId: x.id, lo: 0, hi: 100, hit: true, points: 0, missBy: 0 }));
    expect(initGame(slate, 'daily', results, 5).phase).toBe('complete');
  });
  it('ignores saved results that belong to a different slate', () => {
    const s = initGame(slate, 'daily', [{ questionId: 'zzz', lo: 0, hi: 1, hit: false, points: 0, missBy: 1 }]);
    expect(s.round).toBe(0);
    expect(s.results).toEqual([]);
  });
});


describe('24-second shot clock', () => {
  it('saves a fast lock, then a buzzer zero without repeatable timeout', () => {
    let s = initGame(slate, 'daily', []);
    s = gameReducer(s, { type: 'setWindow', window: { lo: 70, hi: 80 } });
    s = gameReducer(s, { type: 'lock', elapsedMs: 4200 });
    expect(s.results[0]).toMatchObject({ points: 83, elapsedMs: 4200 });
    s = gameReducer(gameReducer(s, { type: 'settle' }), { type: 'next' });
    s = gameReducer(s, { type: 'timeout', elapsedMs: 24000 });
    expect(s.results[1]).toMatchObject({ lo: 0, hi: 100, points: 0, hit: false, timedOut: true, elapsedMs: 24000 });
    expect(gameReducer(s, { type: 'timeout', elapsedMs: 24000 }).results).toHaveLength(2);
  });
});
