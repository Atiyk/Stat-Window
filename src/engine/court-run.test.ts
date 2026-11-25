import { describe, expect, it } from 'vitest';
import type { Slate } from '../content/schema';
import { HALF_COURT_CENTER, HOOP } from './court';
import {
  CHECKPOINT_RADIUS, COURT_END, COURT_LANDMARKS, COURT_START, courtCheckpointMarker, courtLandmarks, courtPosition,
  courtProgress, courtRunCheckpoints, courtRunMarkers,
} from './court-run';
import { gameReducer, initGame, totalPoints, type GameState } from './game';
import { potentialPoints } from './scoring';
import { MAX_TOTAL } from './summary';

const slate: Slate = {
  date: '2026-11-15',
  questions: Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`, sport: 'Basketball', prompt: 'How many wins?', context: 'NBA', answer: 73,
    min: 0, max: 100, step: 1, unit: { singular: 'win', plural: 'wins' }, note: 'Note',
    source: { name: 'W', url: 'https://w.org', quote: '73' }, verified: { on: '2026-11-15', by: 'E' },
  })),
};
const play = (state: GameState, lo: number, hi: number) => {
  const set = gameReducer(state, { type: 'setWindow', window: { lo, hi } });
  return gameReducer(gameReducer(gameReducer(set, { type: 'lock', elapsedMs: 1000 }), { type: 'reveal' }), { type: 'settle' });
};

describe('half-court progression', () => {
  it('starts on the half-court line and reaches the basket centre exactly at 500', () => {
    expect(COURT_START).toEqual(HALF_COURT_CENTER);
    expect(COURT_END).toEqual(HOOP);
    expect(courtPosition(0)).toEqual({ x: 0, y: 25 });
    expect(courtPosition(500)).toEqual({ x: 41.75, y: 25 });
  });

  it('maps real points proportionally and monotonically', () => {
    expect(courtProgress(270)).toBe(.54);
    expect(courtPosition(250).x).toBeCloseTo(41.75 / 2);
    for (let points = 1; points <= MAX_TOTAL; points += 1) {
      expect(courtPosition(points).x).toBeGreaterThan(courtPosition(points - 1).x);
      expect(courtPosition(points).x).toBeCloseTo(41.75 * points / 500);
      expect(courtPosition(points).y).toBe(25);
    }
  });

  it('clamps out-of-bounds scores and handles missing numbers safely', () => {
    expect(courtPosition(-1)).toEqual(COURT_START);
    expect(courtPosition(Number.NaN)).toEqual(COURT_START);
    expect(courtPosition(501)).toEqual(COURT_END);
  });

  it('plots all five cumulative checkpoints and holds the position on a zero', () => {
    const checkpoints = courtRunCheckpoints([75, 0, 60, 90, 45].map((points) => ({ points })));
    expect(checkpoints.map(({ number, total }) => [number, total])).toEqual([[1, 75], [2, 75], [3, 135], [4, 225], [5, 270]]);
    expect(checkpoints[0]?.x).toBe(checkpoints[1]?.x);
    expect(checkpoints[4]).toMatchObject(courtPosition(270));
  });

  it('keeps every checkpoint label separate and on the court even if every round scores zero', () => {
    const markers = courtRunCheckpoints(Array.from({ length: 5 }, () => ({ points: 0 }))).map(courtCheckpointMarker);
    for (const [i, a] of markers.entries()) {
      expect(a.x - CHECKPOINT_RADIUS).toBeGreaterThan(0);
      for (const b of markers.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * CHECKPOINT_RADIUS);
    }
  });

  it('names real court features at the totals where the ball reaches them', () => {
    expect(COURT_LANDMARKS.map(({ at }) => at)).toEqual([216, 336, 453, 500]);
    expect(courtPosition(216).x).toBeGreaterThanOrEqual(HOOP.x - 23.75);
    expect(courtPosition(215).x).toBeLessThan(HOOP.x - 23.75);
    expect(courtLandmarks(0)).toEqual({ reached: null, next: COURT_LANDMARKS[0] });
    expect(courtLandmarks(340).reached?.name).toBe('the free-throw line');
    expect(courtLandmarks(500)).toEqual({ reached: COURT_LANDMARKS[3], next: null });
  });
});

describe('live Court Run markers', () => {
  it('keeps the earned ball fixed while the ghost follows the window’s potential points', () => {
    let state = play(initGame(slate, 'daily', [], 0), 70, 80);
    state = gameReducer(state, { type: 'next' });
    const earned = totalPoints(state.results);
    expect(courtRunMarkers(state)).toEqual({ earned, potential: null });
    for (const [lo, hi] of [[10, 90], [60, 85], [70, 76], [72, 73]] as const) {
      state = gameReducer(state, { type: 'setWindow', window: { lo, hi } });
      const worth = potentialPoints(slate.questions[1]!, { lo, hi });
      expect(courtRunMarkers(state)).toEqual({ earned, potential: worth > 0 ? earned + worth : null });
    }
  });

  it('shows no ghost for a zero-point window', () => {
    const state = gameReducer(initGame(slate, 'daily', [], 0), { type: 'setWindow', window: { lo: 0, hi: 99 } });
    expect(potentialPoints(slate.questions[0]!, state.window)).toBe(0);
    expect(courtRunMarkers(state)).toEqual({ earned: 0, potential: null });
  });

  it('freezes the submitted destination on lock and never leaks the outcome before the reveal', () => {
    const adjusting = gameReducer(initGame(slate, 'daily', [], 0), { type: 'setWindow', window: { lo: 10, hi: 20 } });
    const locked = gameReducer(adjusting, { type: 'lock', elapsedMs: 900 });
    const worth = potentialPoints(slate.questions[0]!, { lo: 10, hi: 20 });
    expect(locked.results[0]!.hit).toBe(false);
    // Even with a stale window value, the destination comes from the submitted record.
    expect(courtRunMarkers({ ...locked, window: { lo: 0, hi: 100 } })).toEqual({ earned: 0, potential: worth });
    const revealing = gameReducer(locked, { type: 'reveal' });
    expect(courtRunMarkers(revealing)).toEqual({ earned: 0, potential: worth });
    expect(courtRunMarkers(gameReducer(revealing, { type: 'settle' }))).toEqual({ earned: 0, potential: null });
  });

  it('moves the earned ball to the confirmed destination on a hit, and nowhere on a zero catch', () => {
    const hit = play(initGame(slate, 'daily', [], 0), 70, 76);
    expect(courtRunMarkers(hit)).toEqual({ earned: hit.results[0]!.points, potential: null });
    expect(hit.results[0]!.points).toBe(potentialPoints(slate.questions[0]!, { lo: 70, hi: 76 }));
    const zero = play(initGame(slate, 'daily', [], 0), 0, 99);
    expect(zero.results[0]).toMatchObject({ hit: true, points: 0 });
    expect(courtRunMarkers(zero)).toEqual({ earned: 0, potential: null });
  });

  it('clears the ghost on a timeout', () => {
    const adjusting = gameReducer(initGame(slate, 'daily', [], 0), { type: 'setWindow', window: { lo: 70, hi: 76 } });
    const expired = gameReducer(adjusting, { type: 'timeout', elapsedMs: 24_000 });
    expect(expired.results[0]!.timedOut).toBe(true);
    expect(courtRunMarkers(expired)).toEqual({ earned: 0, potential: null });
  });

  it('restores a settled round at its earned total without counting it twice', () => {
    const resumed = initGame(slate, 'daily', [{ questionId: 'q0', lo: 70, hi: 80, hit: true, points: 83, missBy: 0 }], 0);
    expect(resumed.phase).toBe('resolved');
    expect(courtRunMarkers(resumed)).toEqual({ earned: 83, potential: null });
    const nextRound = gameReducer(resumed, { type: 'next' });
    expect(courtRunMarkers(nextRound)).toEqual({ earned: 83, potential: null });
  });

  it('never previews past the maximum score', () => {
    let state = initGame(slate, 'daily', [], 0);
    for (let i = 0; i < 4; i++) state = gameReducer(play(state, 72, 73), { type: 'next' });
    state = gameReducer(state, { type: 'setWindow', window: { lo: 72, hi: 73 } });
    expect(courtRunMarkers(state)).toEqual({ earned: 400, potential: 500 });
  });
});
