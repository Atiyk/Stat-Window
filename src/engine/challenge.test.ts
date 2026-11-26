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

describe('friend race links (v2: five round scores)', () => {
  const race = '?day=2026-11-16&vs=247&time=61000&v=2&r=48.61.0.100.38';
  it('parses five round scores that add up to the total', () => {
    expect(parseChallenge(race, today, published)).toEqual({ kind: 'day', day: today, vs: 247, vsTime: 61000, rounds: [48, 61, 0, 100, 38] });
  });
  it('round trips through challengeUrl, in a fixed order', () => {
    const url = challengeUrl('https://stat-window.vercel.app', '2026-11-16', 247, 61000, [48, 61, 0, 100, 38]);
    expect(url).toBe('https://stat-window.vercel.app/?day=2026-11-16&vs=247&time=61000&v=2&r=48.61.0.100.38');
    expect(parseChallenge(new URL(url).search, today, published)).toEqual({ kind: 'day', day: today, vs: 247, vsTime: 61000, rounds: [48, 61, 0, 100, 38] });
  });
  it('legacy links keep their final-total comparison (no rounds)', () => {
    expect(parseChallenge('?day=2026-11-16&vs=247', today, published)).toEqual({ kind: 'day', day: today, vs: 247, vsTime: null });
  });
  it('a tampered race drops every friend score, but still opens the same five questions', () => {
    const none = { kind: 'day', day: today, vs: null, vsTime: null };
    for (const q of [
      '?day=2026-11-16&vs=248&v=2&r=48.61.0.100.38', // total does not match
      '?day=2026-11-16&v=2&r=48.61.0.100.38', // no total
      '?day=2026-11-16&vs=247&v=2&r=48.61.0.100', // four rounds
      '?day=2026-11-16&vs=348&v=2&r=48.61.0.100.38.101', // six rounds
      '?day=2026-11-16&vs=248&v=2&r=48.61.0.101.38', // over 100
      '?day=2026-11-16&vs=247&v=2&r=48.61.00.100.38', // leading zero
      '?day=2026-11-16&vs=247&v=2&r=48.61.-0.100.38',
      '?day=2026-11-16&vs=247&v=2&r=48.61.0.99.5e1',
      '?day=2026-11-16&vs=247&v=2&r=48,61,0,100,38',
      '?day=2026-11-16&vs=247&v=3&r=48.61.0.100.38', // unknown version
      '?day=2026-11-16&vs=247&r=48.61.0.100.38', // rounds without a version
      '?day=2026-11-16&vs=247&v=2&r=48.61.0.100.38&r=48.61.0.100.38', // duplicated
      '?day=2026-11-16&vs=247&vs=247&v=2&r=48.61.0.100.38',
      `?day=2026-11-16&vs=247&v=2&r=48.61.0.100.38&pad=${'x'.repeat(600)}`, // oversized
    ]) expect(parseChallenge(q, today, published), q).toEqual(none);
  });
  it('a duplicated day is refused outright', () => {
    expect(parseChallenge('?day=2026-11-15&day=2026-11-16&vs=1', today, published)).toEqual({ kind: 'invalid' });
  });
  it('carries no answers, windows or question text, only six small numbers', () => {
    const url = new URL(challengeUrl('https://x.app', '2026-11-16', 247, 61000, [48, 61, 0, 100, 38]));
    expect([...url.searchParams.keys()].sort()).toEqual(['day', 'r', 'time', 'v', 'vs']);
  });
});
