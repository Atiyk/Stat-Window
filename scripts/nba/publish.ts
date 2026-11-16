/**
 * Writes the NBA calendar (data/nba/calendar.json) into content/days and keeps
 * content/lock.json, the hash of every day file.
 *
 * Rules:
 *   - A day on or before `today` (UTC) is published. Its file never changes;
 *     a difference is an error, never an overwrite.
 *   - A future day that is already locked changes only with --allow-future-edits.
 *   - Days before the cutover are never touched.
 *
 *   node --experimental-strip-types scripts/nba/publish.ts [--today YYYY-MM-DD] [--check] [--allow-future-edits]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { puzzleDay } from '../../src/engine/daily.ts';
import { buildSlates, loadNbaData, ROOT, serializeSlate, sha256, validateNba } from './model.ts';

export const DAYS_DIR = join(ROOT, 'content', 'days');
export const LOCK_PATH = join(ROOT, 'content', 'lock.json');

export type Lock = { note: string; days: Record<string, string> };

export function readLock(path = LOCK_PATH): Lock {
  if (!existsSync(path)) return { note: '', days: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as Lock;
}

export const LOCK_NOTE =
  'sha256 of every file in content/days. Days on or before the current UTC date are published and must never change. Regenerate with npm run content:publish.';

export function serializeLock(days: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ note: LOCK_NOTE, days: sorted }, null, 2)}\n`;
}

/** Compares day files with the lock. Returns problems; empty means consistent. */
export function checkLock(dir = DAYS_DIR, lock = readLock()): string[] {
  const problems: string[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const day = f.slice(0, 10);
    const want = lock.days[day];
    const got = sha256(readFileSync(join(dir, f)));
    if (!want) problems.push(`${f} is not in content/lock.json`);
    else if (want !== got) problems.push(`${f} changed since it was locked (published content must not change)`);
  }
  for (const day of Object.keys(lock.days))
    if (!files.includes(`${day}.json`)) problems.push(`locked day ${day} has no file in content/days`);
  return problems;
}

function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const today = arg('--today') ?? puzzleDay(new Date());
  const check = process.argv.includes('--check');
  const allowFuture = process.argv.includes('--allow-future-edits');

  const data = loadNbaData();
  const report = validateNba(data);
  if (report.errors.length) {
    for (const e of report.errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  const lock = readLock();
  const next = { ...lock.days };
  const problems: string[] = [];
  let written = 0;
  for (const slate of buildSlates(data)) {
    const path = join(DAYS_DIR, `${slate.date}.json`);
    const bytes = serializeSlate(slate);
    const hash = sha256(bytes);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (current === bytes) {
      next[slate.date] = hash;
      continue;
    }
    if (current !== undefined && slate.date <= today) {
      problems.push(`${slate.date} is published; refusing to change it`);
      continue;
    }
    if (current !== undefined && lock.days[slate.date] && !allowFuture) {
      problems.push(`${slate.date} is locked; rerun with --allow-future-edits to change a future day`);
      continue;
    }
    if (check) {
      problems.push(`${slate.date} is out of date with data/nba`);
      continue;
    }
    writeFileSync(path, bytes);
    next[slate.date] = hash;
    written++;
  }
  // lock any pre-existing day files (the days before the cutover)
  for (const f of readdirSync(DAYS_DIR).filter((x) => x.endsWith('.json'))) {
    const day = f.slice(0, 10);
    if (!next[day]) next[day] = sha256(readFileSync(join(DAYS_DIR, f)));
  }
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  if (!check) writeFileSync(LOCK_PATH, serializeLock(next));
  console.log(`${check ? 'Checked' : 'Published'} ${data.calendar.days.length} NBA days (${written} written). Lock holds ${Object.keys(next).length} days.`);
}

if (process.argv[1]?.endsWith('publish.ts')) main();
