/**
 * Writes the NBA calendar (data/nba/calendar.json) into content/days and records
 * every day's scoring fingerprint in content/published.lock.json.
 *
 * One policy for every day, mixed-sport or NBA (see docs/CONTENT.md, "Published days"):
 *   - A day on or before today (Eastern) is published. This script never rewrites its
 *     file, and the lock refuses any change to its ids, answers, scales or order.
 *   - A future day is regenerated from data/nba whenever data/nba changes.
 *   - Days before the cutover are never touched.
 *
 * `--today` can only make the rule stricter (a later date), never unlock a
 * published day: the effective date is the later of --today and the real Eastern date.
 *
 *   node --experimental-strip-types scripts/nba/publish.ts [--check] [--today YYYY-MM-DD]
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextLock, parseSlate, type ContentLock } from '../../src/content/schema.ts';
import { puzzleDay } from '../../src/engine/daily.ts';
import { buildSlates, loadNbaData, ROOT, serializeSlate, validateNba } from './model.ts';

export const DAYS_DIR = join(ROOT, 'content', 'days');
export const LOCK_PATH = join(ROOT, 'content', 'published.lock.json');

export function readLock(path = LOCK_PATH): ContentLock {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as ContentLock;
}

export const serializeLock = (lock: ContentLock): string => `${JSON.stringify(lock, null, 2)}\n`;

/** The later of two YYYY-MM-DD days. */
export const laterDay = (a: string, b: string): string => (a > b ? a : b);

export type PublishPlan = { write: { date: string; bytes: string }[]; remove: string[]; problems: string[] };

/** What publishing would do, without touching disk. */
export function planPublish(today: string, dir = DAYS_DIR): PublishPlan {
  const data = loadNbaData();
  const problems = validateNba(data).errors.map((e) => `data/nba: ${e}`);
  const write: PublishPlan['write'] = [];
  const remove: string[] = [];
  if (problems.length) return { write, remove, problems };
  if (data.calendar.cutover <= today && !existsSync(join(dir, `${data.calendar.cutover}.json`)))
    problems.push(`cutover ${data.calendar.cutover} is not in the future; reschedule with npm run nba:reschedule`);
  for (const slate of buildSlates(data)) {
    const path = join(dir, `${slate.date}.json`);
    const bytes = serializeSlate(slate);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (current === bytes) continue;
    if (current !== undefined && slate.date <= today) {
      problems.push(`${slate.date} is published; refusing to change it`);
      continue;
    }
    write.push({ date: slate.date, bytes });
  }
  // A future day file from the cutover on that the calendar no longer has (it moved
  // when the calendar was rescheduled) is removed; a published one never is.
  const planned = new Set(data.calendar.days.map((d) => d.date));
  // A generated (themed) file before the cutover is also stale: it is left behind
  // when the cutover moves later.
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const day = f.slice(0, 10);
    const themed = () => 'theme' in (JSON.parse(readFileSync(join(dir, f), 'utf8')) as object);
    if (!planned.has(day) && (day >= data.calendar.cutover || themed())) {
      if (day > today) remove.push(day);
      else problems.push(`${day} is published but not in the NBA calendar`);
    }
  }
  return { write, remove, problems };
}

function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const today = laterDay(arg('--today') ?? '0000-00-00', puzzleDay(new Date()));
  const check = process.argv.includes('--check');
  const plan = planPublish(today);
  const problems = [...plan.problems];
  if (check) {
    for (const w of plan.write) problems.push(`${w.date} is out of date with data/nba; run npm run content:publish`);
    for (const d of plan.remove) problems.push(`${d} is no longer in the NBA calendar; run npm run content:publish`);
  } else {
    for (const w of plan.write) writeFileSync(join(DAYS_DIR, `${w.date}.json`), w.bytes);
    for (const d of plan.remove) rmSync(join(DAYS_DIR, `${d}.json`));
  }

  const slates = readdirSync(DAYS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => parseSlate(JSON.parse(readFileSync(join(DAYS_DIR, f), 'utf8'))));
  const lock = readLock();
  const { lock: next, refused } = nextLock(slates, lock, today);
  for (const day of refused) problems.push(`${day} is published; its ids, answers, scales and order are locked`);
  const lockChanged = serializeLock(next) !== serializeLock(lock);
  if (check && lockChanged) problems.push('content/published.lock.json is out of date; run npm run content:publish');
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  if (!check && lockChanged) writeFileSync(LOCK_PATH, serializeLock(next));
  console.log(
    `${check ? 'Checked' : 'Published'} NBA calendar as of ${today} (${check ? 0 : plan.write.length} written). Lock holds ${Object.keys(next).length} days.`,
  );
}

if (process.argv[1]?.endsWith('publish.ts')) main();
