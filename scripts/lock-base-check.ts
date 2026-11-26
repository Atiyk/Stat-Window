/**
 * The published lock can only grow. `content:publish:check` compares the day files
 * with this branch's own lock, so a branch cut before a day was published can still
 * rewrite that day after it went live and pass. This check compares the lock with
 * a base ref (main by default): every day already published there, and every day
 * on or before today (Eastern), must keep exactly the same fingerprints.
 *
 *   node --experimental-strip-types scripts/lock-base-check.ts [--base origin/main] [--today YYYY-MM-DD]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { puzzleDay } from '../src/engine/daily.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = arg('--base') ?? 'origin/main';
const today = [arg('--today') ?? '0000-00-00', puzzleDay(new Date())].sort().at(-1)!;

let baseText: string;
try {
  baseText = execFileSync('git', ['show', `${base}:content/published.lock.json`], { encoding: 'utf8' });
} catch {
  console.error(`lock-base-check: cannot read content/published.lock.json at ${base}. Fetch it first (git fetch origin main).`);
  process.exit(1);
}
const before = JSON.parse(baseText) as Record<string, string[]>;
const after = JSON.parse(readFileSync('content/published.lock.json', 'utf8')) as Record<string, string[]>;

const problems: string[] = [];
for (const [day, prints] of Object.entries(before)) {
  if (day > today) continue; // locked ahead on the base but not yet live: publish.ts owns it
  const now = after[day];
  if (!now) problems.push(`${day}: published on ${base} but missing from this lock`);
  else if (JSON.stringify(now) !== JSON.stringify(prints)) problems.push(`${day}: fingerprints differ from ${base}`);
}
if (problems.length) {
  console.error(`Published days changed relative to ${base} (today ${today}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`lock-base-check: ${Object.keys(before).filter((d) => d <= today).length} published days match ${base} (today ${today}).`);
