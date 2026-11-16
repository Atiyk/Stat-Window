/**
 * Moves the NBA calendar to a new cutover date: day 1 gets the cutover date and
 * every later day follows consecutively. Themes, question ids, their order and
 * the reserve are kept exactly; only the dates change. Refuses a cutover that is
 * not in the future (UTC), because that would rewrite a published day.
 *
 *   node --experimental-strip-types scripts/nba/reschedule.ts --cutover YYYY-MM-DD
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, puzzleDay } from '../../src/engine/daily.ts';
import type { Calendar } from './model.ts';

export const CALENDAR_PATH = join(import.meta.dirname, '..', '..', 'data', 'nba', 'calendar.json');

export function reschedule(calendar: Calendar, cutover: string, today: string): Calendar {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutover)) throw new Error(`not a date: ${cutover}`);
  if (cutover <= today) throw new Error(`cutover ${cutover} must be after today (${today} UTC)`);
  return {
    ...calendar,
    cutover,
    days: calendar.days.map((d, i) => ({ ...d, date: addDays(cutover, i) })),
  };
}

if (process.argv[1]?.endsWith('reschedule.ts')) {
  const i = process.argv.indexOf('--cutover');
  const cutover = i > -1 ? String(process.argv[i + 1]) : '';
  const cal = JSON.parse(readFileSync(CALENDAR_PATH, 'utf8')) as Calendar;
  const next = reschedule(cal, cutover, puzzleDay(new Date()));
  writeFileSync(CALENDAR_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`NBA calendar: ${next.days.length} days, ${next.days[0]!.date} → ${next.days.at(-1)!.date}`);
}
