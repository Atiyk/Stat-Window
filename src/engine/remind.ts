/**
 * The daily calendar reminder: a repeating event the player adds to their own calendar.
 *
 * Anchored to the puzzle's time zone (America/New_York, src/engine/daily.ts), like the reset.
 * Each file is a daily event at a fixed New York wall-clock hour (DTSTART;TZID=America/New_York
 * with an RFC 5545 VTIMEZONE), so every alarm lands on a new puzzle day, on both sides of every
 * US clock change. The slot is the player's current hour in New York, rounded down; 23 becomes
 * 00, when the next puzzle opens, so the next alarm is always on a puzzle not yet played.
 *
 * Files are static and the same for everyone who picks that hour (public/remind/HH.ics, HH = the
 * New York hour, written by scripts/remind-ics.ts). Nothing here reads the DOM, stores anything
 * or names the player.
 */
import { EPOCH_DAY, PUZZLE_TIME_ZONE, addDays, puzzleDay, puzzleStartUtcMs } from './daily.ts';

export const SITE = 'https://stat-window.vercel.app';
export const REMIND_URL = `${SITE}/?from=calendar`;
export const REMIND_SUMMARY = "Stat Window: today's five";
export const REMIND_DESCRIPTION = `A new puzzle every day at midnight US Eastern time (New York). Same five NBA numbers for everyone.\nPlay: ${REMIND_URL}\nTo stop, delete this repeating event.`;

/** The New York hours a file exists for. 23 is never offered: it is the hour before the reset. */
export const REMIND_HOURS: readonly number[] = Array.from({ length: 23 }, (_, i) => i);

export const REMIND_COPY = {
  label: (time: string) => `Get a daily nudge at ${time}:`,
  ics: 'Apple or Outlook calendar',
  google: 'Google Calendar',
  googleName: 'Google Calendar (opens in a new tab)',
  /** `sameClock`: the player's clocks change with New York's, so the alarm keeps its local time (followsPuzzleClock). */
  note: (sameClock: boolean) =>
    `A plain repeating event in your own calendar. ${
      sameClock
        ? 'The time moves with daylight saving, like the puzzle.'
        : 'It follows US Eastern time, like the puzzle, so here it can move by an hour when US clocks change.'
    } We only count taps here and opens from the event. Delete the event to stop.`,
  toast: 'Reminder file ready. If it downloaded, open it to add the event.',
} as const;

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

const wallFormat = (timeZone?: string) =>
  new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const puzzleWall = wallFormat(PUZZLE_TIME_ZONE);

/** The wall clock of an instant in a zone, as if it were UTC (so two zones' walls can be subtracted). */
function wallMs(fmt: Intl.DateTimeFormat, t: number): number {
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
}

/** The player's current hour in New York, rounded down, with 23 moved to 00 (the next puzzle). */
export function reminderHour(now: Date): number {
  const h = new Date(wallMs(puzzleWall, now.getTime())).getUTCHours();
  return h === 23 ? 0 : h;
}

/**
 * The instant of `hour`:00 New York time on puzzle day `day`, as RFC 5545 §3.3.5 resolves a
 * daily DTSTART;TZID instance: in a fall-back repeat the first of the two, and in the spring-forward
 * gap the time read with the offset from before the gap (02:00 becomes 03:00 EDT).
 */
export function slotUtcMs(day: string, hour: number): number {
  const midnight = puzzleStartUtcMs(day);
  const wanted = Date.parse(`${day}T${pad(hour)}:00:00Z`);
  // The offset in force at midnight, then an hour either side: at most one change a day, never at midnight.
  const offset = wanted - hour * HOUR - midnight; // wall minus UTC at midnight, e.g. -5h in EST
  for (const shift of [0, -HOUR, HOUR]) {
    const t = wanted - offset - shift;
    if (wallMs(puzzleWall, t) === wanted) return t;
  }
  return wanted - offset;
}

/** The first alarm: the slot hour on the next puzzle day (23 → 00 already lands there). */
export function nextReminder(now: Date): Date {
  return new Date(slotUtcMs(addDays(puzzleDay(now), 1), reminderHour(now)));
}

/**
 * True when the player's clock keeps the same distance from New York's at every one of the next
 * `days` alarms: their clocks change with the puzzle's, so the alarm keeps its local time. False
 * in zones without US daylight saving (UTC, London part of the year, Sydney, Kolkata, Phoenix).
 */
export function followsPuzzleClock(now: Date, timeZone?: string, days = 400): boolean {
  const local = wallFormat(timeZone);
  const hour = reminderHour(now);
  const first = addDays(puzzleDay(now), 1);
  let gap: number | null = null;
  for (let i = 0; i < days; i++) {
    const t = slotUtcMs(addDays(first, i), hour);
    const g = wallMs(local, t) - wallMs(puzzleWall, t);
    if (gap === null) gap = g;
    else if (g !== gap) return false;
  }
  return true;
}

/** "7:00 PM", "19:00", "5:30 AM": local time with minutes, so half-hour zones read right. */
export function reminderTime(at: Date, timeZone?: string, locale?: string): string {
  return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

function checkHour(hour: number): string {
  if (!REMIND_HOURS.includes(hour)) throw new Error(`no reminder file for New York hour ${hour}`);
  return pad(hour);
}

export const icsPath = (hour: number) => `/remind/${checkHour(hour)}.ics`;

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1 folding: lines of at most 75 octets, continued with a leading space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > 75) {
      out.push(cur);
      cur = ' ';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

/**
 * America/New_York as RFC 5545 §3.6.5 VTIMEZONE rules: the US rules in force since 2007 (EDT from
 * the second Sunday in March, EST from the first Sunday in November, both at 02:00 local).
 * remind.test.ts checks them against the platform's tz data, hour by hour, for years ahead.
 */
export const PUZZLE_VTIMEZONE: readonly string[] = [
  'BEGIN:VTIMEZONE',
  `TZID:${PUZZLE_TIME_ZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:20070311T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:20071104T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** The first day of the series: puzzle No. 1, a day with no clock change. */
const SERIES_START = EPOCH_DAY.replace(/-/g, '');

/** The exact body of public/remind/HH.ics. */
export function icsText(hour: number): string {
  const hh = checkHour(hour);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stat Window//Daily reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...PUZZLE_VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:stat-window-daily-${hh}-new-york@stat-window.vercel.app`,
    'DTSTAMP:20261122T000000Z',
    `DTSTART;TZID=${PUZZLE_TIME_ZONE}:${SERIES_START}T${hh}0000`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${escapeText(REMIND_SUMMARY)}`,
    `DESCRIPTION:${escapeText(REMIND_DESCRIPTION)}`,
    `URL:${REMIND_URL}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(REMIND_SUMMARY)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Google Calendar's prefilled-event link. Dates are New York wall-clock times with the constant
 * ctz=America/New_York, so the recurrence stays on the New York hour; nothing about the player
 * (not even their zone) is in it.
 */
export function googleCalendarUrl(now: Date): string {
  const day = addDays(puzzleDay(now), 1);
  const hh = pad(reminderHour(now));
  const date = day.replace(/-/g, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: REMIND_SUMMARY,
    details: REMIND_DESCRIPTION,
    dates: `${date}T${hh}0000/${date}T${hh}0500`,
    ctz: PUZZLE_TIME_ZONE,
    recur: 'RRULE:FREQ=DAILY',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
