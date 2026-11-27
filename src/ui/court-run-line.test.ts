import { describe, expect, it } from 'vitest';
import { COURT_LANDMARKS } from '../engine/court-run';
import { courtRunLine } from './PerformanceRecap';

describe('courtRunLine', () => {
  it('says “1 more point”, not “1 more points”', () => {
    const three = COURT_LANDMARKS[0].at;
    expect(courtRunLine(three - 1)).toBe('1 more point reaches the three-point line.');
    const freeThrow = COURT_LANDMARKS[1].at;
    expect(courtRunLine(freeThrow - 1)).toBe('Inside the three-point line. 1 more point reaches the free-throw line.');
  });
  it('keeps the plural for more than one point', () => {
    expect(courtRunLine(COURT_LANDMARKS[0].at - 16)).toBe('16 more points reach the three-point line.');
  });
});
