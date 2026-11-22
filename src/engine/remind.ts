/**
 * The daily calendar reminder: a repeating event the player adds to their own calendar.
 *
 * Anchored to UTC, like the puzzle. The slot is the current UTC hour (23 becomes 00, the reset),
 * so its next occurrence is always tomorrow's puzzle, and every later one lands on a new UTC date:
 * no daylight-saving drift, skip or double, in any time zone. The local time it shows moves by
 * an hour at a clock change, exactly as the puzzle reset does.
 *
 * Files are static and the same for everyone who picks that hour (public/remind/HH.ics, written by
 * scripts/remind-ics.ts). Nothing here reads the DOM, stores anything or names the player.
 */

export const SITE = 'https://stat-window.vercel.app';
export const REMIND_URL = `${SITE}/?from=calendar`;
export const REMIND_SUMMARY = "Stat Window: today's five";
export const REMIND_DESCRIPTION = `A new puzzle every day at midnight UTC. Same five NBA numbers for everyone.\nPlay: ${REMIND_URL}\nTo stop, delete this repeating event.`;

/** The UTC hours a file exists for. 23 is never offered: it is the hour before the reset. */
export const REMIND_HOURS: readonly number[] = Array.from({ length: 23 }, (_, i) => i);

export const REMIND_COPY = {
  label: (time: string) => `Get a daily nudge at ${time}:`,
  ics: 'Apple or Outlook calendar',
  google: 'Google Calendar',
  googleName: 'Google Calendar (opens in a new tab)',
  note: 'A plain repeating event in your own calendar. The time moves with daylight saving, like the puzzle. We only count taps here and opens from the event. Delete the event to stop.',
  toast: 'Opening your calendar. Check it’s saved there.',
} as const;

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The current UTC hour, with 23 moved to 00 so the alarm never falls on the puzzle just played. */
export function reminderHour(now: Date): number {
  const h = now.getUTCHours();
  return h === 23 ? 0 : h;
}

/** The first alarm: the slot hour on the next UTC date. */
export function nextReminder(now: Date): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight + DAY + reminderHour(now) * 3_600_000);
}

/** "7:00 PM", "19:00", "5:30 AM": local time with minutes, so half-hour zones read right. */
export function reminderTime(at: Date, timeZone?: string, locale?: string): string {
  return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

function checkHour(hour: number): string {
  if (!REMIND_HOURS.includes(hour)) throw new Error(`no reminder file for UTC hour ${hour}`);
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

/** The exact body of public/remind/HH.ics. */
export function icsText(hour: number): string {
  const hh = checkHour(hour);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stat Window//Daily reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:stat-window-daily-${hh}z@stat-window.vercel.app`,
    'DTSTAMP:20261101T000000Z',
    `DTSTART:20261101T${hh}0000Z`,
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
 * Google Calendar's prefilled-event link. Dates are in UTC with the constant ctz=UTC, so the
 * recurrence stays on the UTC hour; nothing about the player (not even their zone) is in it.
 */
export function googleCalendarUrl(now: Date): string {
  const at = nextReminder(now);
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: REMIND_SUMMARY,
    details: REMIND_DESCRIPTION,
    dates: `${stamp(at)}/${stamp(new Date(at.getTime() + 5 * 60_000))}`,
    ctz: 'UTC',
    recur: 'RRULE:FREQ=DAILY',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
