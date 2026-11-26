import { describe, expect, it } from 'vitest';
import { addDays, puzzleDay } from './daily';
import { buildHistory } from './history';
import { testRun, testSlate } from './test-fixtures';
import { buildWeek, dayWords, reviewableWeeks, weekdayShort, weekRange, weeklyCard, weeklyShareText, WEEK_MAX, weekStartOf } from './weekly';
import { BETA } from './season';
import type { SavedRun } from './storage';

const S1 = { launchDay: '2026-11-30' }; // a Monday
const MID = { launchDay: '2026-12-02' }; // a Wednesday (midweek launch)

function history(days: Record<string, SavedRun>, season: 'beta' | 's1', config: typeof S1 | typeof BETA, today: string) {
  const slates = Object.fromEntries(Object.keys(days).map((d) => [d, testSlate(d)]));
  return buildHistory(days, season, config, today, slates);
}
const runOn = (day: string, picks?: Parameters<typeof testRun>[1]) => [day, testRun(testSlate(day), picks)] as const;

describe('weeks run Monday to Sunday', () => {
  it('finds the Monday for every weekday, including month and year ends', () => {
    expect(weekStartOf('2026-11-30')).toBe('2026-11-30'); // Monday
    expect(weekStartOf('2026-12-06')).toBe('2026-11-30'); // Sunday belongs to the week that began Monday
    expect(weekStartOf('2026-12-07')).toBe('2026-12-07');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('puts Sunday night and Monday midnight (Eastern) in different weeks, across both DST changes', () => {
    // Sunday 2026-11-29 23:59 EST and Monday 2026-11-30 00:00 EST (UTC-5).
    expect(weekStartOf(puzzleDay(new Date('2026-11-30T04:59:59Z')))).toBe('2026-11-23');
    expect(weekStartOf(puzzleDay(new Date('2026-11-30T05:00:00Z')))).toBe('2026-11-30');
    // Spring forward: Sunday 2027-03-14, 23:59 EDT is 03:59Z Monday; Monday opens at 04:00Z.
    expect(weekStartOf(puzzleDay(new Date('2027-03-15T03:59:59Z')))).toBe('2027-03-08');
    expect(weekStartOf(puzzleDay(new Date('2027-03-15T04:00:00Z')))).toBe('2027-03-15');
    // Fall back: Sunday 2027-11-07 ends at 05:00Z Monday (EST resumes).
    expect(weekStartOf(puzzleDay(new Date('2027-11-08T04:59:59Z')))).toBe('2027-11-01');
    expect(weekStartOf(puzzleDay(new Date('2027-11-08T05:00:00Z')))).toBe('2027-11-08');
  });

  it('a week that spans a DST change still has seven consecutive days', () => {
    const w = buildWeek('2027-03-08', '2027-03-20', 's1', { launchDay: '2026-11-30' }, { records: [], unavailable: [] });
    expect(w.days.map((d) => d.day)).toEqual(['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13', '2027-03-14']);
  });
});

describe('week states', () => {
  const today = '2026-12-02'; // Wednesday
  const days = Object.fromEntries([runOn('2026-11-30'), runOn('2026-12-02', Array(5).fill([0, 100]))]);

  it('separates completed, completed-zero, unplayed, open and future days', () => {
    const w = buildWeek('2026-11-30', today, 's1', S1, history(days, 's1', S1, today));
    expect(w.days.map((d) => d.kind)).toEqual(['completed', 'unplayed', 'completed', 'future', 'future', 'future', 'future']);
    const mon = w.days[0]!;
    expect(mon.kind === 'completed' && mon.points).toBeGreaterThan(0);
    const wed = w.days[2]!;
    expect(wed.kind === 'completed' && wed.points).toBe(0); // a finished zero is not "unplayed"
    expect(w.completed).toBe(2);
    expect(w.status).toBe('current');
  });

  it('marks today open until it is finished', () => {
    const w = buildWeek('2026-11-30', today, 's1', S1, history({ ...Object.fromEntries([runOn('2026-11-30')]) }, 's1', S1, today));
    expect(w.days[2]!.kind).toBe('open');
  });

  it('totals, averages, best day (earliest on a tie) and the 3,500 ceiling', () => {
    const top: [number, number][] = Array(5).fill([73, 74]);
    const d = Object.fromEntries([runOn('2026-11-30', top), runOn('2026-12-01', top), runOn('2026-12-02', Array(5).fill([0, 100]))]);
    const w = buildWeek('2026-11-30', '2026-12-02', 's1', S1, history(d, 's1', S1, '2026-12-02'));
    expect(w.total).toBe(1000);
    expect(w.average).toBe(333);
    expect(w.best).toEqual({ day: '2026-11-30', points: 500 });
    expect(w.maxPossible).toBe(WEEK_MAX);
    expect(WEEK_MAX).toBe(3500);
  });

  it('has no average or best without a completed game', () => {
    const w = buildWeek('2026-11-30', today, 's1', S1, history({}, 's1', S1, today));
    expect([w.average, w.best, w.completed, w.total]).toEqual([null, null, 0, 0]);
  });

  it('a full week is complete', () => {
    const d = Object.fromEntries(Array.from({ length: 7 }, (_, i) => runOn(addDays('2026-11-30', i))));
    const w = buildWeek('2026-11-30', '2026-12-08', 's1', S1, history(d, 's1', S1, '2026-12-08'));
    expect(w.status).toBe('complete');
    expect(w.completed).toBe(7);
  });

  it('a past week with gaps has ended', () => {
    const w = buildWeek('2026-11-30', '2026-12-09', 's1', S1, history(Object.fromEntries([runOn('2026-11-30')]), 's1', S1, '2026-12-09'));
    expect(w.status).toBe('ended');
    expect(w.days.filter((d) => d.kind === 'unplayed')).toHaveLength(6);
  });

  it('flags a finished run that cannot be verified as unavailable, not as zero or unplayed', () => {
    const d = Object.fromEntries([runOn('2026-11-30'), runOn('2026-12-01')]);
    const bad = { ...d['2026-12-01']!, results: d['2026-12-01']!.results.map((r) => ({ ...r, points: 100 })) };
    const h = history({ ...d, '2026-12-01': bad }, 's1', S1, today);
    const w = buildWeek('2026-11-30', today, 's1', S1, h);
    expect(w.days[1]!.kind).toBe('unavailable');
    expect(w.completed).toBe(1);
    expect(dayWords(w.days[1]!)).toBe('record unavailable');
  });
});

describe('midweek launch and seasons', () => {
  it('days before a Wednesday launch are not eligible, and the ceiling shrinks to what existed', () => {
    const today = '2026-12-04';
    const w = buildWeek('2026-11-30', today, 's1', MID, history({}, 's1', MID, today));
    expect(w.days.map((d) => d.kind)).toEqual(['before-season', 'before-season', 'unplayed', 'unplayed', 'open', 'future', 'future']);
    expect(w.seasonDays).toBe(5);
    expect(w.maxPossible).toBe(2500);
    expect(reviewableWeeks(today, 's1', MID)).toEqual(['2026-11-30']); // the previous week was entirely before launch
  });

  it('the week before a Monday launch week is not reviewable; the week after the first is', () => {
    expect(reviewableWeeks('2026-12-03', 's1', S1)).toEqual(['2026-11-30']);
    expect(reviewableWeeks('2026-12-08', 's1', S1)).toEqual(['2026-12-07', '2026-11-30']);
  });

  it('a launch-week run excludes beta history from the same calendar week', () => {
    const d = Object.fromEntries([runOn('2026-11-29'), runOn('2026-12-02')]); // beta Sunday + s1 Wednesday
    const h = history(d, 's1', MID, '2026-12-03');
    expect(h.records.map((r) => r.day)).toEqual(['2026-12-02']);
    const w = buildWeek('2026-11-30', '2026-12-03', 's1', MID, h);
    expect(w.completed).toBe(1);
  });

  it('beta weeks start on the beta epoch', () => {
    expect(reviewableWeeks('2026-11-17', 'beta', BETA)).toEqual(['2026-11-16', '2026-11-09']);
    const w = buildWeek('2026-11-09', '2026-11-17', 'beta', BETA, { records: [], unavailable: [] });
    expect(w.days.filter((d) => d.kind === 'before-season')).toHaveLength(6);
    expect(w.seasonDays).toBe(1);
  });
});

describe('weekly share text', () => {
  it('is spoiler-free, dated, honest about participation and invites play', () => {
    const d = Object.fromEntries([runOn('2026-11-30'), runOn('2026-12-02', Array(5).fill([0, 100]))]);
    const w = buildWeek('2026-11-30', '2026-12-03', 's1', S1, history(d, 's1', S1, '2026-12-03'));
    const text = weeklyShareText(w, 'https://example.test/');
    expect(text).toContain('Stat Window weekly scorecard');
    expect(text).toContain('Nov 30 – Dec 6, 2026');
    expect(text).toContain('Tue not played');
    expect(text).toContain('Wed 0');
    expect(text).toContain('Thu today');
    expect(text).toContain('Sun to come');
    expect(text).toMatch(/Total [\d,]+ · 2 of 7 games played/);
    expect(text).toContain('https://example.test/');
    expect(text).not.toMatch(/How many|\b73\b|answer/i);
  });

  it('states the reduced game count in a midweek launch week', () => {
    const w = buildWeek('2026-11-30', '2026-12-06', 's1', MID, { records: [], unavailable: [] });
    const text = weeklyShareText(w, 'u');
    expect(text).toContain('Mon not open yet');
    expect(text).toContain('0 of 5 games played');
  });

  it('formats dates from the calendar day, never the viewer time zone', () => {
    expect(weekdayShort('2026-12-06')).toBe('Sun');
    expect(weekRange({ start: '2026-12-28', end: '2027-01-03' })).toBe('Dec 28 – Jan 3, 2027');
  });
});

describe('weekly scorecard image model', () => {
  const d = Object.fromEntries([runOn('2026-11-30'), runOn('2026-12-02', Array(5).fill([0, 100])), runOn('2026-12-03')]);
  const h = history(d, 's1', S1, '2026-12-04');
  const week = buildWeek('2026-11-30', '2026-12-04', 's1', S1, h);
  const card = weeklyCard(week, 'https://stat-window.vercel.app/');

  it('carries the exact week, the total against the eligible maximum and the games played', () => {
    expect(card.range).toBe('Nov 30 – Dec 6, 2026');
    expect(card.total).toBe(week.total);
    expect(card.max).toBe(3500);
    expect(card.gamesLine).toBe('3 of 7 games played');
    expect(card.host).toBe('stat-window.vercel.app');
    expect(card.invite).toMatch(/Play along/);
  });

  it('gives each of the seven days a weekday, a date and a state that never relies on colour', () => {
    expect(card.days.map((x) => x.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(card.days[0]!.date).toBe('Nov 30');
    expect(card.days.map((x) => x.mark)).toEqual(['score', 'unplayed', 'zero', 'score', 'open', 'future', 'future']);
    // Every non-scoring state says what it is in words; a zero completion still shows its 0.
    expect(card.days[1]).toMatchObject({ value: '–', note: 'not played', fill: 0 });
    expect(card.days[2]).toMatchObject({ value: '0', note: 'played', fill: 0 });
    expect(card.days[4]).toMatchObject({ value: '', note: 'today' });
    expect(card.days[5]).toMatchObject({ value: '', note: 'to come' });
    const mon = card.days[0]!;
    expect(mon.value).toBe(String(week.days[0]!.kind === 'completed' && week.days[0]!.points));
    expect(mon.fill).toBeCloseTo((week.days[0] as { points: number }).points / 500);
  });

  it('names the best day and the average per completed game, or nothing without a game', () => {
    expect(card.best).toEqual({ weekday: week.best && weekdayShort(week.best.day), points: week.best!.points });
    expect(card.average).toBe(week.average);
    const empty = weeklyCard(buildWeek('2026-11-30', '2026-12-04', 's1', S1, { records: [], unavailable: [] }), 'u');
    expect([empty.best, empty.average, empty.gamesLine]).toEqual([null, null, '0 of 7 games played']);
  });

  it('labels days before launch and unverifiable records distinctly, with the reduced maximum', () => {
    const bad = { ...d['2026-12-03']!, results: d['2026-12-03']!.results.map((r) => ({ ...r, points: 100 })) };
    const w = buildWeek('2026-11-30', '2026-12-04', 's1', MID, history({ ...d, '2026-12-03': bad }, 's1', MID, '2026-12-04'));
    const c = weeklyCard(w, 'u');
    expect(c.days.slice(0, 2).map((x) => [x.mark, x.value, x.note])).toEqual([['prelaunch', '', 'not open'], ['prelaunch', '', 'not open']]);
    expect(c.days[3]).toMatchObject({ mark: 'unavailable', value: '?', note: 'unavailable' });
    expect(c.max).toBe(2500);
    expect(c.gamesLine).toBe('1 of 5 games played');
  });

  it('is spoiler-free: only dates, scores and counts', () => {
    const words = JSON.stringify({ ...card, host: '' }); // the host name itself says "window"
    expect(words).not.toMatch(/How many|answer|window|question/i);
  });
});
