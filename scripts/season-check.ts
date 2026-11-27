/**
 * Release gate for the official season's launch day (src/engine/launch-config.ts).
 *
 * A change to LAUNCH_DAY relative to the base branch is accepted only when:
 * - the new day is a real date strictly after today (Eastern), so a launch can never
 *   start part-way through a published day or renumber a live puzzle;
 * - it is on or after VARIETY_FROM, so every official slate passed the format cap;
 * - at least MIN_OFFICIAL_DAYS consecutive official slates exist from it;
 * - an already-started season is never moved or cancelled (rollback is an explicit,
 *   documented emergency step: SEASON_ROLLBACK_FROM names the cancelled day in the
 *   same commit, see docs/LAUNCH.md);
 * - the new day is at least MIN_LEAD_DAYS ahead, apart from the dated advance
 *   in launch-config.ts. A push to main checks the replaced commit too.
 *
 *   node --experimental-strip-types scripts/season-check.ts [--base origin/main] [--today YYYY-MM-DD]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VARIETY_FROM } from '../src/content/formats.ts';
import { addDays, puzzleDay } from '../src/engine/daily.ts';
import { isIsoDay } from '../src/engine/season.ts';
import { NOVEMBER_LAUNCH_ADVANCE } from '../src/engine/launch-config.ts';

export const MIN_OFFICIAL_DAYS = 28;
/**
 * A launch day must be at least this many days after today (Eastern) when the change
 * is checked, so a pull request that went green late in the evening still lands before
 * the boundary if it is merged the next day. The production build re-checks it.
 */
export const MIN_LEAD_DAYS = 2;
const CONFIG = 'src/engine/launch-config.ts';

/** Reads `export const SEASON_ROLLBACK_FROM = 'YYYY-MM-DD' | null` (absent counts as null). */
export function parseRollbackFrom(text: string): string | null {
  const m = /export const SEASON_ROLLBACK_FROM\s*(?::[^=]+)?=\s*(null|'([^']*)'|"([^"]*)")\s*;/.exec(text);
  return m && m[1] !== 'null' ? (m[2] ?? m[3] ?? null) : null;
}

/** Reads `export const LAUNCH_DAY … = 'YYYY-MM-DD' | null` from the file's text. */
export function parseLaunchConfig(text: string): string | null | undefined {
  const m = /export const LAUNCH_DAY\s*(?::[^=]+)?=\s*(null|'([^']*)'|"([^"]*)")\s*;/.exec(text);
  if (!m) return undefined;
  return m[1] === 'null' ? null : (m[2] ?? m[3] ?? undefined);
}

export function seasonChangeIssues(o: { base: string | null; head: string | null | undefined; today: string; days: readonly string[]; now?: number; rollback?: boolean }): string[] {
  const { base, head, today, days, now = Date.now() } = o;
  if (head === undefined) return [`${CONFIG} must export LAUNCH_DAY as a 'YYYY-MM-DD' string or null`];
  if (head === base) return [];
  const issues: string[] = [];
  if (base !== null && base <= today && !(o.rollback && head === null)) issues.push(`the season that began on ${base} has started; it cannot be moved or cancelled (emergency rollback: docs/LAUNCH.md)`);
  if (head === null) return issues;
  if (!isIsoDay(head)) return [...issues, `LAUNCH_DAY ${head} is not a real date`];
  const advance = NOVEMBER_LAUNCH_ADVANCE;
  const nextDayAdvance = base === advance.from && head === advance.to && today === advance.reviewDay;
  if (head <= today) issues.push(`LAUNCH_DAY ${head} is not in the future (today is ${today} Eastern); a launch must start at a future 12:00 AM Eastern boundary`);
  else if (nextDayAdvance && now >= advance.deadline) issues.push(`The ${head} launch advance closed at 8:00 PM Eastern on ${advance.reviewDay}`);
  else if (!nextDayAdvance && head < addDays(today, MIN_LEAD_DAYS)) issues.push(`LAUNCH_DAY ${head} is less than ${MIN_LEAD_DAYS} days ahead (today is ${today} Eastern); leave a full day so a late merge can't land after the boundary`);
  if (head < VARIETY_FROM) issues.push(`LAUNCH_DAY ${head} is before VARIETY_FROM ${VARIETY_FROM}; earlier slates were not checked for format variety`);
  const have = new Set(days);
  let run = 0;
  while (have.has(addDays(head, run))) run++;
  if (run < MIN_OFFICIAL_DAYS) issues.push(`only ${run} consecutive official slates from ${head}; need at least ${MIN_OFFICIAL_DAYS}`);
  return issues;
}

function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const baseRef = arg('--base') ?? 'origin/main';
  const now = new Date();
  const today = [arg('--today') ?? '0000-00-00', puzzleDay(now)].sort().at(-1)!;
  try {
    execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' });
  } catch {
    // Fail closed: an unreadable base would otherwise look like beta and let a started season move.
    console.error(`season-check: base ${baseRef} is not a commit in this clone; fetch it first`);
    process.exit(1);
  }
  let baseText = '';
  try { baseText = execFileSync('git', ['show', `${baseRef}:${CONFIG}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* the file is not on base yet: beta */ }
  const base = baseText ? parseLaunchConfig(baseText) ?? null : null;
  const headText = readFileSync(CONFIG, 'utf8');
  const head = parseLaunchConfig(headText);
  const rollbackFrom = parseRollbackFrom(headText);
  const days = readdirSync(join(import.meta.dirname, '..', 'content', 'days')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 10));
  const issues = seasonChangeIssues({ base, head, today, days, now: now.getTime(), rollback: base !== null && head === null && rollbackFrom === base });
  if (issues.length) {
    console.error(`season-check: ${issues.join('\n  ')}`);
    process.exit(1);
  }
  console.log(head === base ? `season-check: LAUNCH_DAY unchanged (${String(head)}).` : `season-check: LAUNCH_DAY ${String(base)} -> ${String(head)} accepted (today ${today} Eastern).`);
}

if (process.argv[1]?.endsWith('season-check.ts')) main();
