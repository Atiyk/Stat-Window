import { describe, expect, it } from 'vitest';
import { EPOCH_DAY, PUZZLE_TIME_ZONE, addDays, puzzleDay, puzzleStartUtcMs } from './daily';
import {
  PUZZLE_VTIMEZONE,
  REMIND_COPY,
  REMIND_DESCRIPTION,
  REMIND_HOURS,
  REMIND_SUMMARY,
  REMIND_URL,
  escapeText,
  followsPuzzleClock,
  googleCalendarUrl,
  icsPath,
  icsText,
  nextReminder,
  reminderHour,
  reminderTime,
  slotUtcMs,
} from './remind';

// Read through Vite (tsconfig.app has no Node types): the published days and the committed files.
type Day = { theme?: { title?: string; subtitle?: string }; questions: { prompt: string; answer: number; unit: { singular: string; plural: string } }[] };
const DAYS = import.meta.glob<Day>('../../content/days/*.json', { eager: true, import: 'default' });
const FILES = import.meta.glob<string>('../../public/remind/*', { eager: true, query: '?raw', import: 'default' });

const HOUR = 3_600_000;
const DAY = 86_400_000;
const hh = (h: number) => String(h).padStart(2, '0');
const iso = (t: number) => new Date(t).toISOString();

/** The New York wall clock of an instant, from the platform's tz data: [day, hour, minute]. */
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function nyWall(t: number): { day: string; hour: number; minute: number; offsetMin: number } {
  const p = Object.fromEntries(nyFmt.formatToParts(t).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute));
  return { day: `${p.year}-${p.month}-${p.day}`, hour, minute: Number(p.minute), offsetMin: Math.round((asUtc - Math.floor(t / 60_000) * 60_000) / 60_000) };
}

// ---------------------------------------------------------------------------------------------
// An independent reading of the shipped file: its VTIMEZONE rules and DTSTART;TZID + RRULE, as an
// RFC 5545 client resolves them. Nothing below calls the code under test.
// ---------------------------------------------------------------------------------------------

type Rule = { from: number; to: number; month: number; nth: number; hour: number };
function parseTz(ics: string): { tzid: string; daylight: Rule; standard: Rule } {
  const block = /\r\nBEGIN:VTIMEZONE\r\n([\s\S]*?)\r\nEND:VTIMEZONE\r\n/.exec(ics);
  if (!block) throw new Error('no VTIMEZONE');
  const body = block[1]!;
  const tzid = /^TZID:(.+)$/m.exec(body)![1]!.trim();
  const sub = (name: string): Rule => {
    const s = new RegExp(`BEGIN:${name}\\r\\n([\\s\\S]*?)\\r\\nEND:${name}`).exec(body)![1]!;
    const off = (k: string) => {
      const m = new RegExp(`${k}:([+-])(\\d{2})(\\d{2})`).exec(s)!;
      return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    };
    const rr = /RRULE:FREQ=YEARLY;BYMONTH=(\d+);BYDAY=(\d)SU/.exec(s)!;
    const start = /DTSTART:\d{8}T(\d{2})0000/.exec(s)!;
    return { from: off('TZOFFSETFROM'), to: off('TZOFFSETTO'), month: Number(rr[1]), nth: Number(rr[2]), hour: Number(start[1]) };
  };
  return { tzid, daylight: sub('DAYLIGHT'), standard: sub('STANDARD') };
}

/** The UTC instant a rule's onset happens in a year: nth Sunday of the month, at its local hour in the old offset. */
function onsetUtc(r: Rule, year: number): number {
  const first = new Date(Date.UTC(year, r.month - 1, 1)).getUTCDay();
  const date = 1 + ((7 - first) % 7) + (r.nth - 1) * 7;
  return Date.UTC(year, r.month - 1, date, r.hour) - r.from * 60_000;
}

/** Offset in minutes (local − UTC) the file's VTIMEZONE gives an instant. */
function tzOffset(tz: ReturnType<typeof parseTz>, t: number): number {
  const y = new Date(t).getUTCFullYear();
  return t >= onsetUtc(tz.daylight, y) && t < onsetUtc(tz.standard, y) ? tz.daylight.to : tz.standard.to;
}

/** RFC 5545 §3.3.5: a local time to UTC; a repeated time is the first, a skipped one uses the offset before the gap. */
function localToUtc(tz: ReturnType<typeof parseTz>, wall: number): number {
  const fits = [tz.daylight.to, tz.standard.to]
    .map((o) => wall - o * 60_000)
    .filter((t) => tzOffset(tz, t) * 60_000 === wall - t)
    .sort((a, b) => a - b);
  return fits.length ? fits[0]! : wall - tz.daylight.from * 60_000;
}

/** The first `count` UTC instants after `from` that the imported event fires at. */
function occurrences(ics: string, from: number, count: number): number[] {
  const tz = parseTz(ics);
  const m = /\r\nDTSTART;TZID=([^:]+):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\r\n/.exec(ics);
  if (!m) throw new Error('no DTSTART;TZID');
  expect(m[1]).toBe(tz.tzid);
  expect(ics).toContain('\r\nRRULE:FREQ=DAILY\r\n');
  const [y, mo, d, h, mi, s] = m.slice(2).map(Number) as number[];
  const startDate = Date.UTC(y!, mo! - 1, d!);
  const out: number[] = [];
  // Start a couple of days before `from`, never before DTSTART.
  let k = Math.max(0, Math.floor((from - startDate) / DAY) - 2);
  while (out.length < count) {
    const t = localToUtc(tz, startDate + k * DAY + ((h! * 60 + mi!) * 60 + s!) * 1000);
    if (t > from) out.push(t);
    k++;
  }
  return out;
}

describe('the VTIMEZONE block is America/New_York', () => {
  const tz = parseTz(icsText(0));
  it('names the puzzle zone', () => {
    expect(tz.tzid).toBe(PUZZLE_TIME_ZONE);
    expect(PUZZLE_TIME_ZONE).toBe('America/New_York');
  });
  it('gives the platform tz offset at every hour from 2026 to 2036, and on both sides of every change', { timeout: 30_000 }, () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2037, 0, 1); t += HOUR) {
      if (tzOffset(tz, t) !== nyWall(t).offsetMin) throw new Error(`VTIMEZONE wrong at ${iso(t)}`);
    }
    for (let y = 2026; y <= 2036; y++) {
      for (const r of [tz.daylight, tz.standard]) {
        const at = onsetUtc(r, y);
        expect(tzOffset(tz, at - 1000)).toBe(nyWall(at - 60_000).offsetMin);
        expect(tzOffset(tz, at)).toBe(nyWall(at).offsetMin);
        expect(nyWall(at - 60_000).offsetMin).not.toBe(nyWall(at).offsetMin);
      }
    }
  });
});

describe('reminderHour: the current New York hour, rounded down, with 23 moved to 00 (the next puzzle)', () => {
  it('New York finishing at 1:40 PM EST (18:40Z) gets 13', () => {
    expect(reminderHour(new Date('2026-11-21T18:40:00Z'))).toBe(13);
  });
  it('New York finishing at 11:30 PM EST (04:30Z) gets 00, the moment the next puzzle opens', () => {
    const now = new Date('2026-11-22T04:30:00Z');
    expect(puzzleDay(now)).toBe('2026-11-21');
    expect(reminderHour(now)).toBe(0);
    expect(nextReminder(now).toISOString()).toBe('2026-11-22T05:00:00.000Z');
    expect(nextReminder(now).getTime()).toBe(puzzleStartUtcMs('2026-11-22'));
  });
  it('the same in summer: 11:30 PM EDT (03:30Z) gets 00, at 04:00Z', () => {
    const now = new Date('2027-07-01T03:30:00Z');
    expect(reminderHour(now)).toBe(0);
    expect(nextReminder(now).toISOString()).toBe('2027-07-01T04:00:00.000Z');
  });
  it('just after midnight ET (00:10 EST) keeps 00, tomorrow', () => {
    const now = new Date('2026-11-22T05:10:00Z');
    expect(reminderHour(now)).toBe(0);
    expect(nextReminder(now).toISOString()).toBe('2026-11-23T05:00:00.000Z');
  });
  it('UTC finishing at 23:10Z (6:10 PM EST) gets 18, shown as 11:00 PM UTC', () => {
    const now = new Date('2026-11-21T23:10:00Z');
    expect(reminderHour(now)).toBe(18);
    expect(reminderTime(nextReminder(now), 'UTC', 'en-US')).toBe('11:00 PM');
  });
  it('India finishing at 05:10 IST (23:40Z, 6:40 PM EST) gets 18, shown as 4:30 AM IST tomorrow', () => {
    const now = new Date('2026-11-21T23:40:00Z');
    expect(reminderHour(now)).toBe(18);
    expect(nextReminder(now).toISOString()).toBe('2026-11-22T23:00:00.000Z');
    expect(reminderTime(nextReminder(now), 'Asia/Kolkata', 'en-US')).toBe('4:30 AM');
  });
  it('Sydney finishing at 9:00 AM AEDT (22:00Z, 5:00 PM EST) gets 17', () => {
    expect(reminderHour(new Date('2026-11-21T22:00:00Z'))).toBe(17);
  });

  it('property: for every 20-minute instant of a year the hour is an integer 0-22, never 23', { timeout: 30_000 }, () => {
    const start = Date.parse('2026-11-15T00:00:00Z');
    for (let t = start; t < start + 366 * DAY; t += 20 * 60_000) {
      const h = reminderHour(new Date(t));
      if (!(Number.isInteger(h) && h >= 0 && h <= 22)) throw new Error(`hour ${h} at ${iso(t)}`);
    }
  });

  it('property: the next alarm is strictly later, on the next puzzle day, at minute 0 ET, within 25 hours', { timeout: 30_000 }, () => {
    const start = Date.parse('2026-11-15T00:00:00Z');
    for (let t = start; t < start + 366 * DAY; t += 20 * 60_000) {
      const now = new Date(t);
      const at = nextReminder(now).getTime();
      const w = nyWall(at);
      const ok =
        at > t &&
        at - t <= 25 * HOUR &&
        puzzleDay(new Date(at)) === addDays(puzzleDay(now), 1) &&
        w.minute === 0 &&
        // The slot hour, except 02:00 on a spring-forward day, which does not exist and fires at 03:00 EDT.
        (w.hour === reminderHour(now) || (reminderHour(now) === 2 && w.hour === 3));
      if (!ok) throw new Error(`finish ${iso(t)} → ${iso(at)}`);
    }
  });

  it('shows the local time with minutes, for any offset including half and quarter hours', () => {
    const at = new Date('2026-11-23T00:00:00Z'); // 7:00 PM EST
    expect(reminderTime(at, 'America/New_York', 'en-US')).toBe('7:00 PM');
    expect(reminderTime(at, 'Asia/Kolkata', 'en-US')).toBe('5:30 AM');
    expect(reminderTime(at, 'Asia/Kathmandu', 'en-US')).toBe('5:45 AM');
    expect(reminderTime(at, 'UTC', 'en-US')).toBe('12:00 AM');
  });
});

describe('slotUtcMs: a New York wall-clock hour on a puzzle day, across the March and November changes', () => {
  it('spring forward, Sunday 14 March 2027: 02:00 does not exist and resolves to 03:00 EDT', () => {
    expect(iso(slotUtcMs('2027-03-14', 0))).toBe('2027-03-14T05:00:00.000Z');
    expect(iso(slotUtcMs('2027-03-14', 1))).toBe('2027-03-14T06:00:00.000Z');
    expect(iso(slotUtcMs('2027-03-14', 2))).toBe('2027-03-14T07:00:00.000Z');
    expect(iso(slotUtcMs('2027-03-14', 3))).toBe('2027-03-14T07:00:00.000Z');
    expect(iso(slotUtcMs('2027-03-14', 22))).toBe('2027-03-15T02:00:00.000Z');
    expect(iso(slotUtcMs('2027-03-13', 22))).toBe('2027-03-14T03:00:00.000Z');
  });
  it('fall back, Sunday 1 November 2026 and 7 November 2027: 01:00 is the first (EDT) one', () => {
    expect(iso(slotUtcMs('2026-11-01', 0))).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(slotUtcMs('2026-11-01', 1))).toBe('2026-11-01T05:00:00.000Z');
    expect(iso(slotUtcMs('2026-11-01', 2))).toBe('2026-11-01T07:00:00.000Z');
    expect(iso(slotUtcMs('2027-11-07', 1))).toBe('2027-11-07T05:00:00.000Z');
    expect(iso(slotUtcMs('2027-11-07', 12))).toBe('2027-11-07T17:00:00.000Z');
  });
  it('finishing in the repeated 1 AM hour (01:30 EST, second pass) still alarms tomorrow at 01:00', () => {
    const now = new Date('2026-11-01T06:30:00Z');
    expect(nyWall(now.getTime()).hour).toBe(1);
    expect(reminderHour(now)).toBe(1);
    expect(nextReminder(now).toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });
  it('agrees with the independent .ics reading for every hour and every day of 2027', { timeout: 30_000 }, () => {
    for (const h of REMIND_HOURS) {
      const from = puzzleStartUtcMs('2027-01-01') - 1;
      const fires = occurrences(icsText(h), from, 366);
      fires.forEach((t, i) => {
        if (t !== slotUtcMs(addDays('2027-01-01', i), h)) throw new Error(`hour ${h} day ${i}: ${iso(t)}`);
      });
    }
  });
});

describe('daylight saving: exactly one alarm per puzzle day for 400 days', () => {
  const zones: [string, boolean][] = [
    ['America/New_York', true],
    ['Europe/London', false],
    ['Australia/Sydney', false],
    ['Asia/Kolkata', false],
  ];
  for (const [zone, sameClock] of zones) {
    it(`${zone}: every finish time over a year gives one alarm on each of the next 400 puzzle days, none on today's`, () => {
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const localMinutes = (t: number) => {
        const [hr, min] = local.format(t).split(':').map(Number);
        return (hr! % 24) * 60 + min!;
      };
      const start = Date.parse(`${EPOCH_DAY}T00:00:00Z`);
      // Each slot's alarms, read from its file once, with their puzzle day, New York and local clock.
      const series = new Map<number, { t: number; day: string; ny: ReturnType<typeof nyWall>; local: number }[]>();
      const alarms = (slot: number) => {
        let s = series.get(slot);
        if (!s) {
          s = occurrences(icsText(slot), start - 1, 830).map((t) => ({ t, day: puzzleDay(new Date(t)), ny: nyWall(t), local: localMinutes(t) }));
          series.set(slot, s);
        }
        return s;
      };
      let n = 0;
      // Finish times every 5h07m for 400 days, so every hour of the day and both sides of every clock change are covered.
      for (let t = start; t < start + 400 * DAY; t += 5 * HOUR + 7 * 60_000) {
        const now = new Date(t);
        const slot = reminderHour(now);
        const label = `${zone} finish ${iso(t)} slot ${slot}`;
        const all = alarms(slot);
        const first = all.findIndex((a) => a.t > t);
        const fires = all.slice(first, first + 400);
        expect(fires.length, label).toBe(400);
        expect(occurrences(icsText(slot), t, 1)[0], label).toBe(fires[0]!.t);
        expect(fires[0]!.t, label).toBe(nextReminder(now).getTime());
        // Consecutive puzzle days, starting with the next one: one alarm per puzzle, no skipped day, no doubled one.
        const today = puzzleDay(now);
        const wrong = fires.findIndex((f, i) => f.day !== addDays(today, i + 1));
        expect(wrong, label).toBe(-1);
        // Always the slot's New York hour (02:00 on a spring-forward day fires at 03:00 EDT).
        for (const f of fires) {
          if (!(f.ny.minute === 0 && (f.ny.hour === slot || (slot === 2 && f.ny.hour === 3)))) throw new Error(`${label}: ${iso(f.t)}`);
        }
        // The local time moves only by whole clock changes: an hour at a time, a few times a year.
        let moves = 0;
        for (let i = 1; i < fires.length; i++) {
          const gap = Math.abs(fires[i]!.local - fires[i - 1]!.local);
          const step = Math.min(gap, 1440 - gap);
          if (step !== 0 && step !== 60) throw new Error(`${label}: local step ${step} at ${iso(fires[i]!.t)}`);
          if (step) moves++;
        }
        // New York: none, except the 02:00 slot on spring-forward days. Elsewhere: each US and local change, at most a few.
        expect(moves, label).toBeLessThanOrEqual(sameClock ? (slot === 2 ? 4 : 0) : 10);
        if (!sameClock) expect(moves, label).toBeGreaterThan(0);
        // The on-screen note says "moves with daylight saving" only where that holds (sampled: it walks 400 days itself).
        if (++n % 25 === 0) expect(followsPuzzleClock(now, zone), label).toBe(sameClock);
      }
    }, 60_000);
  }
  it('followsPuzzleClock: other US zones keep their local time; Phoenix, UTC and Kathmandu do not', () => {
    const now = new Date('2026-11-21T18:40:00Z');
    expect(followsPuzzleClock(now, 'America/Chicago')).toBe(true);
    expect(followsPuzzleClock(now, 'America/Los_Angeles')).toBe(true);
    expect(followsPuzzleClock(now, 'America/Toronto')).toBe(true);
    expect(followsPuzzleClock(now, 'America/Phoenix')).toBe(false);
    expect(followsPuzzleClock(now, 'UTC')).toBe(false);
    expect(followsPuzzleClock(now, 'Asia/Kathmandu')).toBe(false);
  });
});

describe('icsText', () => {
  it('is valid RFC 5545 for every offered hour: CRLF, folded at 75 octets, balanced, TZID start, VTIMEZONE, daily, fixed URL and UID', () => {
    expect(REMIND_HOURS).toEqual(Array.from({ length: 23 }, (_, i) => i));
    for (const h of REMIND_HOURS) {
      const ics = icsText(h);
      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const lines = ics.slice(0, -2).split('\r\n');
      for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      const begins = lines.filter((l) => l.startsWith('BEGIN:')).map((l) => l.slice(6));
      const ends = lines.filter((l) => l.startsWith('END:')).map((l) => l.slice(4));
      expect(begins).toEqual(['VCALENDAR', 'VTIMEZONE', 'DAYLIGHT', 'STANDARD', 'VEVENT', 'VALARM']);
      expect(ends).toEqual(['DAYLIGHT', 'STANDARD', 'VTIMEZONE', 'VALARM', 'VEVENT', 'VCALENDAR']);
      expect(lines[0]).toBe('BEGIN:VCALENDAR');
      // The VTIMEZONE comes before the event that refers to it.
      expect(lines.indexOf('END:VTIMEZONE')).toBeLessThan(lines.indexOf('BEGIN:VEVENT'));
      expect(lines.slice(lines.indexOf('BEGIN:VTIMEZONE'), lines.indexOf('END:VTIMEZONE') + 1)).toEqual(PUZZLE_VTIMEZONE);
      expect(lines).toContain(`DTSTART;TZID=America/New_York:${EPOCH_DAY.replace(/-/g, '')}T${hh(h)}0000`);
      // No floating or UTC event times: only the TZID start (the VTIMEZONE's own DTSTARTs are local by rule).
      expect(lines.filter((l) => l.startsWith('DTSTART')).length).toBe(3);
      expect(lines).toContain('RRULE:FREQ=DAILY');
      expect(lines).toContain(`URL:${REMIND_URL}`);
      expect(REMIND_URL).toBe('https://stat-window.vercel.app/?from=calendar');
      expect(lines).toContain(`UID:stat-window-daily-${hh(h)}-new-york@stat-window.vercel.app`);
      expect(lines).toContain('VERSION:2.0');
      expect(lines).toContain('DTSTAMP:20261122T000000Z');
      expect(lines).toContain('DURATION:PT5M');
      expect(lines).toContain('TRANSP:TRANSPARENT');
      expect(lines).toContain('ACTION:DISPLAY');
      expect(lines).toContain('TRIGGER:PT0M');
    }
  });

  it('starts the series on puzzle No. 1, a day with no clock change', () => {
    expect(EPOCH_DAY).toBe('2026-11-15');
    expect(puzzleStartUtcMs(addDays(EPOCH_DAY, 1)) - puzzleStartUtcMs(EPOCH_DAY)).toBe(DAY);
  });

  it('escapes TEXT values: commas, semicolons, backslashes and newlines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const unfolded = icsText(0).replace(/\r\n /g, '');
    expect(unfolded).toContain(`\r\nDESCRIPTION:${escapeText(REMIND_DESCRIPTION)}\r\n`);
    expect(unfolded).toContain('To stop\\, delete this repeating event.');
    expect(unfolded).toContain('midnight US Eastern time (New York)');
    expect(unfolded).not.toContain('UTC');
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
  it('prefills a daily repeating 5-minute event at the New York slot, with only constant text', () => {
    const now = new Date('2026-11-22T04:30:00Z'); // 11:30 PM EST on the 21st: slot 00 on the 22nd
    const u = new URL(googleCalendarUrl(now));
    expect(u.origin).toBe('https://calendar.google.com');
    expect(u.pathname).toBe('/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY');
    expect(u.searchParams.get('dates')).toBe('20261122T000000/20261122T000500');
    // Wall-clock times in ctz, no Z.
    expect(u.searchParams.get('dates')).toMatch(/^\d{8}T\d{2}0000\/\d{8}T\d{2}0500$/);
    // A constant: anchors the recurrence to the puzzle's zone without saying anything about the player.
    expect(u.searchParams.get('ctz')).toBe('America/New_York');
    expect(u.searchParams.get('text')).toBe(REMIND_SUMMARY);
    expect(u.searchParams.get('details')).toBe(REMIND_DESCRIPTION);
    expect([...u.searchParams.keys()].sort()).toEqual(['action', 'ctz', 'dates', 'details', 'recur', 'text']);
    // Encoded: no raw spaces or newlines in the URL itself.
    expect(googleCalendarUrl(now)).not.toMatch(/[ \n]/);
  });
  it('uses the same slot and day as the file: 15:00Z (10:00 AM EST) gives tomorrow 10:00 ET', () => {
    const u = new URL(googleCalendarUrl(new Date('2026-11-17T15:00:00Z')));
    expect(u.searchParams.get('dates')).toBe('20261118T100000/20261118T100500');
  });
  it('names the same New York day and hour as nextReminder for every 20 minutes of a year', { timeout: 30_000 }, () => {
    const start = Date.parse('2026-11-15T00:00:00Z');
    for (let t = start; t < start + 366 * DAY; t += 20 * 60_000) {
      const now = new Date(t);
      const dates = new URL(googleCalendarUrl(now)).searchParams.get('dates')!;
      const day = addDays(puzzleDay(now), 1).replace(/-/g, '');
      if (dates !== `${day}T${hh(reminderHour(now))}0000/${day}T${hh(reminderHour(now))}0500`) throw new Error(`${iso(t)}: ${dates}`);
      if (puzzleDay(nextReminder(now)).replace(/-/g, '') !== day) throw new Error(`${iso(t)}: day`);
    }
  });
});

describe('the note', () => {
  it('says "moves with daylight saving" only when the clocks match, and plainly says US Eastern otherwise', () => {
    expect(REMIND_COPY.note(true)).toContain('The time moves with daylight saving, like the puzzle.');
    expect(REMIND_COPY.note(true)).not.toContain('Eastern');
    expect(REMIND_COPY.note(false)).toContain('It follows US Eastern time, like the puzzle');
    expect(REMIND_COPY.note(false)).not.toContain('moves with daylight saving');
    for (const v of [true, false]) expect(REMIND_COPY.note(v)).toContain('We only count taps here and opens from the event. Delete the event to stop.');
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
      REMIND_COPY.note(true),
      REMIND_COPY.note(false),
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
