import { describe, expect, it } from 'vitest';
import {
  REMIND_COPY,
  REMIND_DESCRIPTION,
  REMIND_HOURS,
  REMIND_SUMMARY,
  REMIND_URL,
  escapeText,
  googleCalendarUrl,
  icsPath,
  icsText,
  nextReminder,
  reminderHour,
  reminderTime,
} from './remind';

// Read through Vite (tsconfig.app has no Node types): the published days and the committed files.
type Day = { theme?: { title?: string; subtitle?: string }; questions: { prompt: string; answer: number; unit: { singular: string; plural: string } }[] };
const DAYS = import.meta.glob<Day>('../../content/days/*.json', { eager: true, import: 'default' });
const FILES = import.meta.glob<string>('../../public/remind/*', { eager: true, query: '?raw', import: 'default' });

const HOUR = 3_600_000;
const DAY = 86_400_000;
const utcDate = (d: Date | number) => new Date(d).toISOString().slice(0, 10);
const hh = (h: number) => String(h).padStart(2, '0');

describe('reminderHour: the current UTC hour, with 23 moved to 00 (the reset)', () => {
  // The slot is a UTC hour, so the player's time zone never changes it.
  it('Eastern time finishing at 1:40 PM (18:40Z) gets 18Z (1:00 PM)', () => {
    expect(reminderHour(new Date('2026-11-21T18:40:00Z'))).toBe(18);
  });
  it('Eastern time finishing at 6:30 PM (23:30Z) gets 00Z, the moment the next puzzle opens', () => {
    expect(reminderHour(new Date('2026-11-21T23:30:00Z'))).toBe(0);
  });
  it('Eastern time finishing at 7:40 PM (00:40Z) keeps 00Z', () => {
    expect(reminderHour(new Date('2026-11-22T00:40:00Z'))).toBe(0);
  });
  it('UTC finishing at 23:10 gets 00Z', () => {
    expect(reminderHour(new Date('2026-11-21T23:10:00Z'))).toBe(0);
  });
  it('India finishing at 05:10 IST (23:40Z) gets 00Z (05:30 IST), and at 05:40 IST (00:10Z) also 00Z, tomorrow', () => {
    expect(reminderHour(new Date('2026-11-21T23:40:00Z'))).toBe(0);
    const now = new Date('2026-11-22T00:10:00Z');
    expect(reminderHour(now)).toBe(0);
    // The half-hour zone case the floating-time design could not handle: the next alarm is tomorrow's puzzle.
    expect(nextReminder(now).toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(reminderTime(nextReminder(now), 'Asia/Kolkata', 'en-US')).toBe('5:30 AM');
  });
  it('Sydney finishing at 9:00 AM AEDT (22:00Z) gets 22Z', () => {
    expect(reminderHour(new Date('2026-11-21T22:00:00Z'))).toBe(22);
  });

  it('property: for every 10-minute instant of a week the hour is an integer 0-22, never 23', () => {
    const start = Date.parse('2026-11-01T00:00:00Z');
    for (let t = start; t < start + 7 * DAY; t += 10 * 60_000) {
      const h = reminderHour(new Date(t));
      expect(Number.isInteger(h) && h >= 0 && h <= 22).toBe(true);
    }
  });

  it('property: the next alarm is strictly later, on a later UTC date (never the puzzle just played), within 25 hours', () => {
    const start = Date.parse('2026-11-01T00:00:00Z');
    for (let t = start; t < start + 7 * DAY; t += 10 * 60_000) {
      const now = new Date(t);
      const at = nextReminder(now);
      expect(at.getTime()).toBeGreaterThan(t);
      expect(at.getTime() - t).toBeLessThanOrEqual(25 * HOUR);
      expect(utcDate(at) > utcDate(now)).toBe(true);
      expect(at.getUTCHours()).toBe(reminderHour(now));
      expect(at.getUTCMinutes()).toBe(0);
    }
  });

  it('shows the local time with minutes, for any offset including half and quarter hours', () => {
    const at = new Date('2026-11-23T00:00:00Z');
    expect(reminderTime(at, 'America/New_York', 'en-US')).toBe('7:00 PM');
    expect(reminderTime(at, 'Asia/Kathmandu', 'en-US')).toBe('5:45 AM');
    expect(reminderTime(at, 'UTC', 'en-US')).toBe('12:00 AM');
  });
});

/** The UTC instants an imported event fires at, read from the file itself (DTSTART + RRULE:FREQ=DAILY). */
function occurrences(ics: string, from: number, count: number): number[] {
  const m = /\r\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\r\n/.exec(ics);
  if (!m) throw new Error('no UTC DTSTART');
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const dtstart = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
  expect(ics).toContain('\r\nRRULE:FREQ=DAILY\r\n');
  const out: number[] = [];
  let k = Math.max(0, Math.ceil((from - dtstart) / DAY));
  while (out.length < count) {
    const t = dtstart + k * DAY;
    if (t > from) out.push(t);
    k++;
  }
  return out;
}

describe('daylight saving: exactly one alarm per UTC date for 400 days', () => {
  const zones = ['America/New_York', 'Europe/London', 'Australia/Sydney'];
  for (const zone of zones) {
    it(`${zone}: every finish time over a year gives one alarm on each of the next 400 puzzle days, none on today's`, () => {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const localMinutes = (t: number) => {
        const [hr, min] = fmt.format(t).split(':').map(Number);
        return hr! * 60 + min!;
      };
      const start = Date.parse('2026-11-01T00:00:00Z');
      // Finish times every 5h07m for 400 days, so every hour of the day and both sides of every clock change are covered.
      for (let t = start; t < start + 400 * DAY; t += 5 * HOUR + 7 * 60_000) {
        const now = new Date(t);
        const fires = occurrences(icsText(reminderHour(now)), t, 400);
        const dates = fires.map(utcDate);
        // Consecutive UTC dates, starting tomorrow: one alarm per puzzle, no skipped day, no doubled one.
        const tomorrow = Date.parse(`${utcDate(now)}T00:00:00Z`) + DAY;
        const wrong = dates.findIndex((d, i) => d !== utcDate(tomorrow + i * DAY));
        expect(wrong, `${zone} finish ${now.toISOString()}`).toBe(-1);
        expect(new Set(dates).size).toBe(400);
        // The local time moves only by the clock change (60 minutes), like the puzzle reset.
        const distinct = [...new Set(fires.map(localMinutes))];
        expect(distinct.length).toBeLessThanOrEqual(2);
        if (distinct.length === 2) {
          const gap = Math.abs(distinct[0]! - distinct[1]!);
          expect(Math.min(gap, 1440 - gap)).toBe(60);
        }
      }
    });
  }
});

describe('icsText', () => {
  it('is valid RFC 5545 for every offered hour: CRLF, folded at 75 octets, balanced, UTC start, daily, fixed URL and UID', () => {
    expect(REMIND_HOURS).toEqual(Array.from({ length: 23 }, (_, i) => i));
    for (const h of REMIND_HOURS) {
      const ics = icsText(h);
      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const lines = ics.slice(0, -2).split('\r\n');
      for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      const begins = lines.filter((l) => l.startsWith('BEGIN:')).map((l) => l.slice(6));
      const ends = lines.filter((l) => l.startsWith('END:')).map((l) => l.slice(4));
      expect(begins).toEqual(['VCALENDAR', 'VEVENT', 'VALARM']);
      expect(ends).toEqual(['VALARM', 'VEVENT', 'VCALENDAR']);
      expect(lines[0]).toBe('BEGIN:VCALENDAR');
      expect(lines).toContain(`DTSTART:20261101T${hh(h)}0000Z`);
      expect(ics).not.toContain('TZID');
      expect(lines).toContain('RRULE:FREQ=DAILY');
      expect(lines).toContain(`URL:${REMIND_URL}`);
      expect(REMIND_URL).toBe('https://stat-window.vercel.app/?from=calendar');
      expect(lines).toContain(`UID:stat-window-daily-${hh(h)}z@stat-window.vercel.app`);
      expect(lines).toContain('VERSION:2.0');
      expect(lines).toContain('DURATION:PT5M');
      expect(lines).toContain('TRANSP:TRANSPARENT');
      expect(lines).toContain('ACTION:DISPLAY');
      expect(lines).toContain('TRIGGER:PT0M');
    }
  });

  it('escapes TEXT values: commas, semicolons, backslashes and newlines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const unfolded = icsText(0).replace(/\r\n /g, '');
    expect(unfolded).toContain(`\r\nDESCRIPTION:${escapeText(REMIND_DESCRIPTION)}\r\n`);
    expect(unfolded).toContain('To stop\\, delete this repeating event.');
    expect(unfolded).toContain(`\r\nSUMMARY:${escapeText(REMIND_SUMMARY)}\r\n`);
    // No unescaped comma or semicolon left in any TEXT value.
    for (const line of unfolded.split('\r\n').filter((l) => /^(SUMMARY|DESCRIPTION):/.test(l))) {
      expect(line.replace(/\\[\\,;n]/g, '')).not.toMatch(/[,;]/);
    }
  });

  it('rejects an hour it never offers', () => {
    expect(() => icsText(23)).toThrow();
    expect(() => icsPath(24)).toThrow();
    expect(icsPath(0)).toBe('/remind/00.ics');
    expect(icsPath(15)).toBe('/remind/15.ics');
  });
});

describe('googleCalendarUrl', () => {
  it('prefills a daily repeating 5-minute event at the UTC slot, with only constant text', () => {
    const now = new Date('2026-11-21T23:30:00Z');
    const u = new URL(googleCalendarUrl(now));
    expect(u.origin).toBe('https://calendar.google.com');
    expect(u.pathname).toBe('/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY');
    expect(u.searchParams.get('dates')).toBe('20261122T000000Z/20261122T000500Z');
    expect(u.searchParams.get('dates')).toMatch(/^\d{8}T\d{2}0000Z\/\d{8}T\d{2}0500Z$/);
    // A constant: anchors the recurrence to UTC without saying anything about the player.
    expect(u.searchParams.get('ctz')).toBe('UTC');
    expect(u.searchParams.get('text')).toBe(REMIND_SUMMARY);
    expect(u.searchParams.get('details')).toBe(REMIND_DESCRIPTION);
    expect([...u.searchParams.keys()].sort()).toEqual(['action', 'ctz', 'dates', 'details', 'recur', 'text']);
    // Encoded: no raw spaces or newlines in the URL itself.
    expect(googleCalendarUrl(now)).not.toMatch(/[ \n]/);
  });
  it('uses the same slot as the file: 15:00Z finish gives tomorrow 15:00Z', () => {
    const u = new URL(googleCalendarUrl(new Date('2026-11-17T15:00:00Z')));
    expect(u.searchParams.get('dates')).toBe('20261118T150000Z/20261118T150500Z');
  });
});

describe('leak guard: no question, theme, answer or urgency in anything the reminder ships', () => {
  it('holds for every published day', () => {
    const shipped = [
      ...REMIND_HOURS.map(icsText),
      googleCalendarUrl(new Date('2026-11-21T15:00:00Z')),
      decodeURIComponent(googleCalendarUrl(new Date('2026-11-21T15:00:00Z'))),
      REMIND_COPY.label('7:00 PM'),
      REMIND_COPY.ics,
      REMIND_COPY.google,
      REMIND_COPY.googleName,
      REMIND_COPY.note,
      REMIND_COPY.toast,
    ].join('\n');
    const lower = shipped.toLowerCase();
    for (const word of ['hurry', 'don’t lose', "don't lose", ' left', 'streak', 'score']) expect(lower).not.toContain(word);
    const days = Object.values(DAYS);
    expect(days.length).toBeGreaterThan(60);
    for (const day of days) {
      for (const t of [day.theme?.title, day.theme?.subtitle]) if (t) expect(shipped).not.toContain(t);
      for (const q of day.questions) {
        expect(shipped).not.toContain(q.prompt);
        expect(lower).not.toContain(`${q.answer} ${q.unit.plural}`.toLowerCase());
        expect(lower).not.toContain(`${q.answer} ${q.unit.singular}`.toLowerCase());
      }
    }
  });
});

describe('committed files', () => {
  it('public/remind holds exactly 00.ics-22.ics, each byte for byte icsText (npm run remind:ics regenerates them)', () => {
    const names = Object.keys(FILES).map((k) => k.split('/').pop()).sort();
    expect(names).toEqual(REMIND_HOURS.map((h) => `${hh(h)}.ics`));
    for (const h of REMIND_HOURS) expect(FILES[`../../public/remind/${hh(h)}.ics`]).toBe(icsText(h));
  });
});
