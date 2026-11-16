/**
 * Validates every slate in content/days. Exits non-zero on any error, so it
 * gates `npm run build` (and therefore every Vercel deploy) and CI.
 *   node --experimental-strip-types scripts/content-check.ts [--today YYYY-MM-DD]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkInventory, checkLock, parseSlate, runwayDays, type ContentLock, type Slate } from '../src/content/schema.ts';
import { puzzleDay } from '../src/engine/daily.ts';
import { buildSlates, loadNbaData, serializeSlate, validateNba } from './nba/model.ts';
import { DAYS_DIR } from './nba/publish.ts';

const dir = join(import.meta.dirname, '..', 'content', 'days');
const todayArg = process.argv.indexOf('--today');
const today = todayArg > -1 ? String(process.argv[todayArg + 1]) : puzzleDay(new Date());

const slates: Slate[] = [];
const errors: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  try {
    const slate = parseSlate(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (`${slate.date}.json` !== file) errors.push(`${file}: date field is ${slate.date}`);
    slates.push(slate);
  } catch (e) {
    errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const report = checkInventory(slates, today);
errors.push(...report.errors);
const lockFile = join(import.meta.dirname, '..', 'content', 'published.lock.json');
const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as ContentLock;
const locked = checkLock(slates, lock, today);
errors.push(...locked.errors);
const warnings = [...report.warnings, ...locked.warnings];

// NBA database gates: data/nba must validate, content/days must match it, and
// published days keep their locked scoring fields (checked above).
const nba = loadNbaData();
const nbaReport = validateNba(nba);
errors.push(...nbaReport.errors.map((e) => `data/nba: ${e}`));
for (const s of buildSlates(nba)) {
  let current = '';
  try {
    current = readFileSync(join(DAYS_DIR, `${s.date}.json`), 'utf8');
  } catch {
    /* missing file is reported below */
  }
  if (current !== serializeSlate(s)) errors.push(`content/days/${s.date}.json differs from data/nba; run npm run content:publish`);
}
console.log(`NBA database: ${nba.facts.length} verified facts, ${nba.calendar.days.length} days from ${nba.calendar.cutover}, ${nba.calendar.reserve.length} in reserve`);

console.log(`Stat Window content: ${slates.length} slates, ${slates.length * 5} questions, ${report.firstDay} → ${report.lastDay}`);
const left = runwayDays(slates, today);
console.log(
  `Runway from ${today}: ${left} day${left === 1 ? '' : 's'} of puzzles (last: ${report.lastDay}). After that players see no new daily puzzle until more are published.`,
);
const ci = process.env.GITHUB_ACTIONS === 'true';
for (const w of warnings) console.warn(ci ? `::warning title=Stat Window content::${w}` : `warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log('All content valid.');
