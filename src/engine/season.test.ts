import { describe, expect, it } from 'vitest';
import { addDays, puzzleNumber } from './daily';
import { BETA, inSeason, isRetiredDay, parseLaunchDay, playableDays, publicNumber, seasonConfigFrom, seasonOf } from './season';

const LAUNCH = { launchDay: '2027-01-10' };

describe('beta (the live default) keeps every number it has always had', () => {
  it.each(['2026-11-15', '2026-11-18', '2027-01-27'])('%s', (day) => {
    expect(publicNumber(day, BETA)).toEqual({ season: 'beta', number: puzzleNumber(day), label: `No. ${puzzleNumber(day)}` });
  });
  it('is what an unset or invalid config gives', () => {
    for (const raw of [undefined, '', 'soon', '2026-02-30', '2026-11-15', '2026-11-01']) {
      expect(seasonConfigFrom({ launchDay: raw })).toEqual(BETA);
    }
  });
});

describe('formal launch dry run (synthetic launch day 2027-01-10)', () => {
  it('Day 1 is No. 1 and Day 2 is No. 2', () => {
    expect(publicNumber('2027-01-10', LAUNCH)).toEqual({ season: 's1', number: 1, label: 'No. 1' });
    expect(publicNumber('2027-01-11', LAUNCH)).toEqual({ season: 's1', number: 2, label: 'No. 2' });
    expect(publicNumber(addDays('2027-01-10', 30), LAUNCH).number).toBe(31);
  });

  it('the day before launch is a labelled beta puzzle with its original number', () => {
    expect(publicNumber('2027-01-09', LAUNCH)).toEqual({ season: 'beta', number: puzzleNumber('2027-01-09'), label: `Beta No. ${puzzleNumber('2027-01-09')}` });
  });

  it('changes season exactly at 00:00 UTC', () => {
    const before = new Date('2027-01-09T23:59:59.999Z').toISOString().slice(0, 10);
    const after = new Date('2027-01-10T00:00:00.000Z').toISOString().slice(0, 10);
    expect(seasonOf(before, LAUNCH)).toBe('beta');
    expect(seasonOf(after, LAUNCH)).toBe('s1');
  });

  it('does not hide beta puzzles before launch, but retires them at Day 1', () => {
    const days = ['2026-11-15', '2027-01-09', '2027-01-10', '2027-01-11'];
    expect(playableDays(days, '2027-01-09', LAUNCH)).toEqual(days);
    expect(playableDays(days, '2027-01-10', LAUNCH)).toEqual(['2027-01-10', '2027-01-11']);
    expect(playableDays(days, '2027-01-11', LAUNCH).filter((d) => d < '2027-01-11')).toEqual(['2027-01-10']);
    expect(playableDays(days, '2027-01-11', BETA)).toEqual(days);
    expect(isRetiredDay('2027-01-09', '2027-01-09', LAUNCH)).toBe(false);
    expect(isRetiredDay('2027-01-09', '2027-01-10', LAUNCH)).toBe(true);
    expect(isRetiredDay('2027-01-10', '2027-01-10', LAUNCH)).toBe(false);
    expect(isRetiredDay('2026-11-15', '2027-01-11', BETA)).toBe(false);
    expect(isRetiredDay('not-a-day', '2027-01-11', LAUNCH)).toBe(false);
  });

  it('keeps beta runs out of launch-season stats', () => {
    const runs = { '2026-11-18': 1, '2027-01-09': 2, '2027-01-10': 3, '2027-01-11': 4 };
    expect(Object.keys(inSeason(runs, 's1', LAUNCH))).toEqual(['2027-01-10', '2027-01-11']);
    expect(Object.keys(inSeason(runs, 'beta', LAUNCH))).toEqual(['2026-11-18', '2027-01-09']);
    expect(Object.keys(inSeason(runs, 'beta', BETA))).toHaveLength(4);
  });

  it('previews only when the build allows it', () => {
    expect(seasonConfigFrom({ preview: '1' }, '?launch-preview=2027-01-10')).toEqual(LAUNCH);
    expect(seasonConfigFrom({}, '?launch-preview=2027-01-10')).toEqual(BETA);
    expect(seasonConfigFrom({ preview: '1' }, '?launch-preview=nonsense')).toEqual(BETA);
    expect(parseLaunchDay('2027-01-10')).toBe('2027-01-10');
  });
});

describe('a scheduled launch changes no label before it begins', () => {
  const LAUNCH = { launchDay: '2027-01-10' };
  it('keeps beta numbering until today reaches the launch day, then marks beta days', () => {
    expect(publicNumber('2027-01-05', LAUNCH, '2027-01-05').label).toBe(`No. ${puzzleNumber('2027-01-05')}`);
    expect(publicNumber('2027-01-05', LAUNCH, '2027-01-10').label).toBe(`Beta No. ${puzzleNumber('2027-01-05')}`);
    expect(publicNumber('2027-01-10', LAUNCH, '2027-01-10').label).toBe('No. 1');
  });
});
