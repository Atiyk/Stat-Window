import { describe, expect, it } from 'vitest';
import { eventPath, privacySignal, totalBand, type TrackEvent } from './track';

describe('eventPath', () => {
  it('maps every event to a fixed, low-cardinality path with no answers or ids', () => {
    const cases: [TrackEvent, string][] = [
      [{ name: 'visit_new' }, '/e/visit/new'],
      [{ name: 'visit_return', gap: 1, age: 1 }, '/e/visit/return/gap-1/day1'],
      [{ name: 'visit_return', gap: 3, age: 7 }, '/e/visit/return/gap-2-6/day7'],
      [{ name: 'visit_return', gap: 9, age: 30 }, '/e/visit/return/gap-7plus'],
      [{ name: 'run_start', mode: 'daily' }, '/e/start/daily'],
      [{ name: 'first_touch', mode: 'challenge' }, '/e/first-touch/challenge'],
      [{ name: 'round_lock', mode: 'daily', round: 3, hit: false }, '/e/lock/daily/r3/miss'],
      [{ name: 'round_next', mode: 'practice', round: 5 }, '/e/next/practice/r5'],
      [{ name: 'run_exit', mode: 'daily', round: 2 }, '/e/exit/daily/r2'],
      [{ name: 'run_complete', mode: 'daily', total: 274 }, '/e/complete/daily/200-299'],
      [{ name: 'share', mode: 'daily', method: 'clipboard' }, '/e/share/daily/clipboard'],
      [{ name: 'challenge_open', kind: 'past', withScore: true }, '/e/challenge-open/past/with-score'],
    ];
    for (const [e, path] of cases) expect(eventPath(e)).toBe(path);
  });
  it('bands totals the same way as the results distribution', () => {
    expect([0, 99, 100, 399, 400, 500].map(totalBand)).toEqual(['0-99', '0-99', '100-199', '300-399', '400-500', '400-500']);
  });
});

describe('privacySignal', () => {
  it('honours Global Privacy Control and Do Not Track', () => {
    expect(privacySignal({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: '1' } as unknown as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: 'unspecified' } as unknown as Navigator)).toBe(false);
  });
});
