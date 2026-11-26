/**
 * Release gate for the official season's launch day (src/engine/launch-config.ts).
 *
 * A change to LAUNCH_DAY relative to the base branch is accepted only when:
 * - the new day is a real date strictly after today (Eastern), so a launch can never
 *   start part-way through a published day or renumber a live puzzle;
 * - it is on or after VARIETY_FROM, so every official slate passed the format cap;
 * - at least MIN_OFFICIAL_DAYS consecutive official slates exist from it;
 * - an already-started season is never moved or cancelled (rollback is an explicit,
 *   documented emergency step: SEASON_ROLLBACK=1, see docs/LAUNCH.md).
 *
 *   node --experimental-strip-types scripts/season-check.ts [--base origin/main] [--today YYYY-MM-DD]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VARIETY_FROM } from '../src/content/formats.ts';
import { addDays, puzzleDay } from '../src/engine/daily.ts';
import { isIsoDay } from '../src/engine/season.ts';

export const MIN_OFFICIAL_DAYS = 28;
const CONFIG = 'src/engine/launch-config.ts';

/** Reads `export const LAUNCH_DAY … = 'YYYY-MM-DD' | null` from the file's text. */
export function parseLaunchConfig(text: string): string | null | undefined {
  const m = /export const LAUNCH_DAY\s*(?::[^=]+)?=\s*(null|'([^']*)'|"([^"]*)")\s*;/.exec(text);
  if (!m) return undefined;
  return m[1] === 'null' ? null : (m[2] ?? m[3] ?? undefined);
}

export function seasonChangeIssues(o: { base: string | null; head: string | null | undefined; today: string; days: readonly string[]; rollback?: boolean }): string[] {
  const { base, head, today, days } = o;
  if (head === undefined) return [`${CONFIG} must export LAUNCH_DAY as a 'YYYY-MM-DD' string or null`];
  if (head === base) return [];
  const issues: string[] = [];
  if (base !== null && base <= today && !o.rollback) issues.push(`the season that began on ${base} has started; it cannot be moved or cancelled (emergency rollback: docs/LAUNCH.md)`);
  if (head === null) return issues;
  if (!isIsoDay(head)) return [...issues, `LAUNCH_DAY ${head} is not a real date`];
  if (head <= today) issues.push(`LAUNCH_DAY ${head} is not in the future (today is ${today} Eastern); a launch must start at a future 12:00 AM Eastern boundary`);
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
  const today = [arg('--today') ?? '0000-00-00', puzzleDay(new Date())].sort().at(-1)!;
  let baseText = '';
  try { baseText = execFileSync('git', ['show', `${baseRef}:${CONFIG}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* not on base yet: beta */ }
  const base = baseText ? parseLaunchConfig(baseText) ?? null : null;
  const head = parseLaunchConfig(readFileSync(CONFIG, 'utf8'));
  const days = readdirSync(join(import.meta.dirname, '..', 'content', 'days')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 10));
  const issues = seasonChangeIssues({ base, head, today, days, rollback: process.env.SEASON_ROLLBACK === '1' });
  if (issues.length) {
    console.error(`season-check: ${issues.join('\n  ')}`);
    process.exit(1);
  }
  console.log(head === base ? `season-check: LAUNCH_DAY unchanged (${String(head)}).` : `season-check: LAUNCH_DAY ${String(base)} -> ${String(head)} accepted (today ${today} Eastern).`);
}

if (process.argv[1]?.endsWith('season-check.ts')) main();
