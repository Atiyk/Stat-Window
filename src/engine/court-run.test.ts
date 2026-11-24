import { describe, expect, it } from 'vitest';
import type { Slate } from '../content/schema';
import {
  COURT_HOOP, COURT_START, courtCheckpointMarkerY, courtPosition, courtProgress, courtRunCheckpoints,
} from './court-run';
import { initGame, totalPoints } from './game';
import { MAX_TOTAL } from './summary';

describe('half-court progression', () => {
  it('starts at half court and reaches the hoop exactly at 500', () => {
    expect(courtPosition(0)).toEqual(COURT_START);
    expect(courtPosition(500)).toEqual(COURT_HOOP);
  });

  it('maps real points proportionally and monotonically on the same center line', () => {
    expect(courtProgress(270)).toBe(.54);
    expect(courtPosition(250).x).toBe((COURT_START.x + COURT_HOOP.x) / 2);
    for (let points = 1; points <= MAX_TOTAL; points += 1) {
      expect(courtPosition(points).x).toBeGreaterThan(courtPosition(points - 1).x);
      expect(courtPosition(points).y).toBe(COURT_START.y);
    }
  });

  it('clamps out-of-bounds scores and handles missing numbers safely', () => {
    expect(courtPosition(-1)).toEqual(COURT_START);
    expect(courtPosition(Number.NaN)).toEqual(COURT_START);
    expect(courtPosition(501)).toEqual(COURT_HOOP);
  });

  it('plots all five cumulative checkpoints and holds the position on a zero', () => {
    const checkpoints = courtRunCheckpoints([75, 0, 60, 90, 45].map((points) => ({ points })));
    expect(checkpoints.map(({ number, total }) => [number, total])).toEqual([[1, 75], [2, 75], [3, 135], [4, 225], [5, 270]]);
    expect(checkpoints[0]?.x).toBe(checkpoints[1]?.x);
    expect(checkpoints[4]).toMatchObject(courtPosition(270));
  });

  it('keeps all checkpoint labels separate even if every round scores zero', () => {
    const checkpoints = courtRunCheckpoints(Array.from({ length: 5 }, () => ({ points: 0 })));
    const ys = checkpoints.map(courtCheckpointMarkerY).sort((a, b) => a - b);
    expect(checkpoints.every(({ x }) => x === COURT_START.x)).toBe(true);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(17);
  });

  it('uses the saved score immediately when reopening a locked round', () => {
    const slate: Slate = {
      date: '2026-11-15',
      questions: Array.from({ length: 5 }, (_, i) => ({
        id: `q${i}`, sport: 'Basketball', prompt: 'How many wins?', context: 'NBA', answer: 73,
        min: 0, max: 100, step: 1, unit: { singular: 'win', plural: 'wins' }, note: 'Note',
        source: { name: 'W', url: 'https://w.org', quote: '73' }, verified: { on: '2026-11-15', by: 'E' },
      })),
    };
    const resumed = initGame(slate, 'daily', [{ questionId: 'q0', lo: 70, hi: 80, hit: true, points: 83, missBy: 0 }], 0);
    expect(resumed.phase).toBe('resolved');
    expect(courtPosition(totalPoints(resumed.results))).toEqual(courtPosition(83));
  });
});
