import { describe, expect, it } from 'vitest';
import { puzzleDay, puzzleNumber, msUntilNextPuzzle, addDays, EPOCH_DAY } from './daily';

describe('puzzleDay (midnight Eastern for everyone)', () => {
  it('uses the New York day, not the UTC date', () => {
    expect(puzzleDay(new Date('2026-11-16T04:59:59.999Z'))).toBe('2026-11-15');
    expect(puzzleDay(new Date('2026-11-16T05:00:00.000Z'))).toBe('2026-11-16');
  });
  it('follows Eastern daylight saving changes', () => {
    expect(puzzleDay(new Date('2027-03-15T03:59:59Z'))).toBe('2027-03-14');
    expect(puzzleDay(new Date('2027-03-15T04:00:00Z'))).toBe('2027-03-15');
  });
});

describe('puzzleNumber', () => {
  it('numbers the launch day as No. 1', () => {
    expect(EPOCH_DAY).toBe('2026-11-15');
    expect(puzzleNumber('2026-11-15')).toBe(1);
    expect(puzzleNumber('2026-11-27')).toBe(13);
  });
  it('crosses month and year boundaries', () => {
    expect(puzzleNumber('2026-12-01')).toBe(17);
    expect(puzzleNumber('2027-01-01')).toBe(48);
  });
});

describe('addDays', () => {
  it('moves across months and leap days', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-15', -1)).toBe('2026-11-14');
  });
});

describe('msUntilNextPuzzle', () => {
  it('counts down to midnight Eastern, including 23- and 25-hour days', () => {
    expect(msUntilNextPuzzle(new Date('2026-11-16T04:00:00Z'))).toBe(60 * 60 * 1000);
    expect(msUntilNextPuzzle(new Date('2026-11-16T05:00:00Z'))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilNextPuzzle(new Date('2027-03-14T05:00:00Z'))).toBe(23 * 60 * 60 * 1000);
    expect(msUntilNextPuzzle(new Date('2027-11-07T04:00:00Z'))).toBe(25 * 60 * 60 * 1000);
  });
});
