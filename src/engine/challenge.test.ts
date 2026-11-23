import { describe, expect, it } from 'vitest';
import { challengeUrl, parseChallenge, parseScore } from './challenge';
import { playableDays } from './season';

const published = ['2026-11-15', '2026-11-16', '2026-11-17'];
const today = '2026-11-16';

describe('parseChallenge', () => {
  it('ignores a bare link (old shares keep working)', () => {
    expect(parseChallenge('', today, published)).toEqual({ kind: 'none' });
    expect(parseChallenge('?utm_source=x', today, published)).toEqual({ kind: 'none' });
  });
  it('accepts today and earlier published days, with an optional score', () => {
    expect(parseChallenge('?day=2026-11-16&vs=312', today, published)).toEqual({ kind: 'day', day: '2026-11-16', vs: 312, vsTime: null });
    expect(parseChallenge('?day=2026-11-15', today, published)).toEqual({ kind: 'day', day: '2026-11-15', vs: null, vsTime: null });
  });
  it('keeps the same puzzle after the sender’s UTC day has rolled over', () => {
    expect(parseChallenge('?day=2026-11-16&vs=90', '2026-11-17', published)).toEqual({ kind: 'day', day: '2026-11-16', vs: 90, vsTime: null });
  });
  it('rejects retired beta links after Day 1 but keeps valid s1 shares', () => {
    const all = ['2027-01-09', '2027-01-10', '2027-01-11'];
    const launch = { launchDay: '2027-01-10' };
    expect(parseChallenge('?day=2027-01-09&vs=300', '2027-01-09', playableDays(all, '2027-01-09', launch))).toMatchObject({ kind: 'day', day: '2027-01-09' });
    expect(parseChallenge('?day=2027-01-09&vs=300', '2027-01-10', playableDays(all, '2027-01-10', launch))).toEqual({ kind: 'invalid' });
    expect(parseChallenge('?day=2027-01-10&vs=300', '2027-01-11', playableDays(all, '2027-01-11', launch))).toEqual({ kind: 'day', day: '2027-01-10', vs: 300, vsTime: null });
    expect(parseChallenge('?day=2027-01-11&vs=300', '2027-01-10', playableDays(all, '2027-01-10', launch))).toEqual({ kind: 'future' });
  });

  it('never opens a future puzzle', () => {
    expect(parseChallenge('?day=2026-11-17', today, published)).toEqual({ kind: 'future' });
  });
  it('rejects malformed, impossible or unpublished days', () => {
    for (const q of ['?day=2026-13-01', '?day=2026-02-30', '?day=yesterday', '?day=2026-11-1', '?day=', '?day=2020-01-01']) {
      expect(parseChallenge(q, today, published).kind).toBe('invalid');
    }
  });
  it('drops a score that is not a plain whole number from 0 to 500', () => {
    for (const vs of ['501', '-1', '12.5', 'abc', '1e2', '', '0999']) {
      expect(parseChallenge(`?day=2026-11-15&vs=${vs}`, today, published)).toEqual({ kind: 'day', day: '2026-11-15', vs: null, vsTime: null });
    }
    expect(parseScore('0')).toBe(0);
    expect(parseScore('500')).toBe(500);
  });
});

describe('challengeUrl', () => {
  it('builds a link that parses back to the same day and score', () => {
    const url = challengeUrl('https://stat-window.vercel.app', '2026-11-15', 240);
    expect(url).toBe('https://stat-window.vercel.app/?day=2026-11-15&vs=240');
    expect(parseChallenge(new URL(url).search, today, published)).toEqual({ kind: 'day', day: '2026-11-15', vs: 240, vsTime: null });
  });
});


describe('time tiebreaker challenge', () => {
  it('round trips a validated time and ignores impossible claims', () => {
    const url = challengeUrl('https://stat-window.vercel.app', '2026-11-16', 333, 72123);
    expect(parseChallenge(new URL(url).search, today, published)).toEqual({ kind: 'day', day: today, vs: 333, vsTime: 72123 });
    expect(parseChallenge('?day=2026-11-16&vs=333&time=999999', today, published)).toMatchObject({ kind: 'day', vsTime: null });
  });
});
