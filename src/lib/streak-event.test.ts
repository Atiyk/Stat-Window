import { describe, expect, it } from 'vitest';
import { eventPath, setCohort } from './track';

describe('streak event (docs/MEASUREMENT.md)', () => {
  it('buckets the daily streak as 1, 2-6 or 7plus', () => {
    setCohort('beta');
    expect(eventPath({ name: 'streak', days: 1 })).toBe('/e/streak/daily/1');
    expect(eventPath({ name: 'streak', days: 2 })).toBe('/e/streak/daily/2-6');
    expect(eventPath({ name: 'streak', days: 6 })).toBe('/e/streak/daily/2-6');
    expect(eventPath({ name: 'streak', days: 7 })).toBe('/e/streak/daily/7plus');
    expect(eventPath({ name: 'streak', days: 40 })).toBe('/e/streak/daily/7plus');
  });
  it('carries the QA and season prefixes like every other event', () => {
    setCohort('qa');
    expect(eventPath({ name: 'streak', days: 3 })).toBe('/e/qa/streak/daily/2-6');
    setCohort('beta');
  });
});
