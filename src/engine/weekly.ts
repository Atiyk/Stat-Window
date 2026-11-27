/**
 * Weekly Scoreboard calculations. Weeks run Monday to Sunday on the game's
 * canonical Eastern puzzle-day calendar: every day here is an ISO puzzle day
 * (`puzzleDay`), so Eastern midnight and daylight-saving changes are already
 * resolved before a date reaches this module. Definitions: docs/V5.1-STATS.md.
 */
import { addDays, EPOCH_DAY } from './daily';
import type { OfficialHistory } from './history';
import { MAX_POINTS_PER_ROUND } from './scoring';
import type { SeasonConfig, SeasonId } from './season';

export const WEEK_DAYS = 7;
export const WEEK_MAX = WEEK_DAYS * 5 * MAX_POINTS_PER_ROUND;

/**
 * - completed: a verified finished run (possibly worth zero)
 * - unplayed: the day has passed with no eligible finished run
 * - open: today, not finished yet
 * - future: has not happened yet
 * - before-season: before the season (or midweek launch) began, so no eligible game existed
 * - unavailable: a finished run exists but could not be verified against its slate
 */
export type DayState =
  | { readonly day: string; readonly kind: 'completed'; readonly points: number }
  | { readonly day: string; readonly kind: 'unplayed' | 'open' | 'future' | 'before-season' | 'unavailable' };

export type Week = {
  readonly start: string;
  readonly end: string;
  readonly days: readonly DayState[];
  readonly completed: number;
  readonly total: number;
  /** Rounded average per completed game; null with no completed game. */
  readonly average: number | null;
  /** Highest-scoring completed day (earliest on a tie). */
  readonly best: { readonly day: string; readonly points: number } | null;
  /** Days of this week that belong to the season (not before launch). */
  readonly seasonDays: number;
  /** The most the season's days of this week could have scored (7 full days = 3,500). */
  readonly maxPossible: number;
  readonly status: 'complete' | 'current' | 'ended';
};

/** The Monday on or before `day`. */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function seasonStart(season: SeasonId, config: SeasonConfig): string {
  return season === 's1' && config.launchDay ? config.launchDay : EPOCH_DAY;
}

/** Every week from the current one back to the first that the season covers (newest first). */
export function reviewableWeeks(today: string, season: SeasonId, config: SeasonConfig): string[] {
  const first = weekStartOf(seasonStart(season, config));
  const weeks = [weekStartOf(today)];
  for (let w = addDays(weeks[0]!, -WEEK_DAYS); w >= first; w = addDays(w, -WEEK_DAYS)) weeks.push(w);
  return weeks;
}

export function buildWeek(weekStart: string, today: string, season: SeasonId, config: SeasonConfig, history: OfficialHistory): Week {
  const start = seasonStart(season, config);
  const totals = new Map(history.records.map((r) => [r.day, r.total] as const));
  const unavailable = new Set(history.unavailable);
  const days: DayState[] = Array.from({ length: WEEK_DAYS }, (_, i): DayState => {
    const day = addDays(weekStart, i);
    if (day < start) return { day, kind: 'before-season' };
    if (day > today) return { day, kind: 'future' };
    const points = totals.get(day);
    if (points !== undefined) return { day, kind: 'completed', points };
    if (unavailable.has(day)) return { day, kind: 'unavailable' };
    return { day, kind: day === today ? 'open' : 'unplayed' };
  });
  const done = days.filter((d): d is Extract<DayState, { kind: 'completed' }> => d.kind === 'completed');
  const total = done.reduce((s, d) => s + d.points, 0);
  let best: Week['best'] = null;
  for (const d of done) if (!best || d.points > best.points) best = { day: d.day, points: d.points };
  const seasonDays = days.filter((d) => d.kind !== 'before-season').length;
  const end = addDays(weekStart, WEEK_DAYS - 1);
  return {
    start: weekStart,
    end,
    days,
    completed: done.length,
    total,
    average: done.length ? Math.round(total / done.length) : null,
    best,
    seasonDays,
    maxPossible: seasonDays * 5 * MAX_POINTS_PER_ROUND,
    status: seasonDays > 0 && done.length === seasonDays ? 'complete' : today >= weekStart && today <= end ? 'current' : 'ended',
  };
}

const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
export const weekdayShort = (day: string) => fmt(day, { weekday: 'short' });
export const weekdayLong = (day: string) => fmt(day, { weekday: 'long' });
export const monthDay = (day: string) => fmt(day, { month: 'short', day: 'numeric' });

/** "Nov 30 – Dec 6, 2026" (the year is the week's last day). */
export function weekRange(week: Pick<Week, 'start' | 'end'>): string {
  return `${monthDay(week.start)} – ${monthDay(week.end)}, ${week.end.slice(0, 4)}`;
}

/** Plain words for one day, used by screen readers and the share text. */
export function dayWords(d: DayState): string {
  switch (d.kind) {
    case 'completed': return `${d.points} points`;
    case 'unplayed': return 'not played';
    case 'open': return 'today, not finished';
    case 'future': return 'not yet played';
    case 'before-season': return 'before the season began';
    case 'unavailable': return 'record unavailable';
  }
}

const SHARE_STATE: Record<Exclude<DayState['kind'], 'completed'>, string> = {
  unplayed: 'not played',
  open: 'today',
  future: 'to come',
  'before-season': 'not open yet',
  unavailable: 'unavailable',
};

/**
 * Spoiler-free weekly scorecard: daily scores only (never answers or questions),
 * exact dates, the count behind the total, and an invitation. Participation is
 * stated so two friends with different counts are never compared as equals.
 */
export function weeklyShareText(week: Week, url: string): string {
  return [
    'Stat Window weekly scorecard',
    weekRange(week),
    ...week.days.map((d) => `${weekdayShort(d.day)} ${d.kind === 'completed' ? d.points : SHARE_STATE[d.kind]}`),
    `Total ${week.total.toLocaleString('en-US')} · ${week.completed} of ${week.seasonDays} ${week.seasonDays === 1 ? 'game' : 'games'} played`,
    'Same daily five for everyone. Play along:',
    url,
  ].join('\n');
}

/**
 * What the weekly scorecard image shows, as data: the canvas only draws this.
 * Each day carries a mark (its shape), a value and a word, so no state depends on
 * colour: a played zero shows "0", an unplayed day "–" and "not played".
 */
export type WeeklyCardDay = {
  readonly weekday: string;
  readonly date: string;
  readonly mark: 'score' | 'zero' | 'unplayed' | 'open' | 'future' | 'prelaunch' | 'unavailable';
  readonly value: string;
  readonly note: string | null;
  /** Bar height, 0 to 1 of a 500-point day. */
  readonly fill: number;
};

export type WeeklyCardModel = {
  readonly range: string;
  readonly total: number;
  readonly max: number;
  readonly completed: number;
  readonly gamesLine: string;
  readonly days: readonly WeeklyCardDay[];
  readonly best: { readonly weekday: string; readonly points: number } | null;
  readonly average: number | null;
  readonly invite: string;
  readonly host: string;
};

const CARD_DAY: Record<Exclude<DayState['kind'], 'completed'>, Pick<WeeklyCardDay, 'mark' | 'value' | 'note'>> = {
  unplayed: { mark: 'unplayed', value: '–', note: 'not played' },
  open: { mark: 'open', value: '', note: 'today' },
  future: { mark: 'future', value: '', note: 'to come' },
  'before-season': { mark: 'prelaunch', value: '', note: 'not open' },
  unavailable: { mark: 'unavailable', value: '?', note: 'unavailable' },
};

export function weeklyCard(week: Week, url: string): WeeklyCardModel {
  return {
    range: weekRange(week),
    total: week.total,
    max: week.maxPossible,
    completed: week.completed,
    gamesLine: `${week.completed} of ${week.seasonDays} ${week.seasonDays === 1 ? 'game' : 'games'} played`,
    days: week.days.map((d): WeeklyCardDay => {
      const base = { weekday: weekdayShort(d.day), date: monthDay(d.day) };
      if (d.kind !== 'completed') return { ...base, ...CARD_DAY[d.kind], fill: 0 };
      return d.points > 0
        ? { ...base, mark: 'score', value: String(d.points), note: null, fill: d.points / (5 * MAX_POINTS_PER_ROUND) }
        : { ...base, mark: 'zero', value: '0', note: 'played', fill: 0 };
    }),
    best: week.best ? { weekday: weekdayShort(week.best.day), points: week.best.points } : null,
    average: week.average,
    invite: 'Same daily five for everyone. Play along.',
    host: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}
