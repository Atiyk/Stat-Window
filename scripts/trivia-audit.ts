/**
 * Editorial completeness and spoiler audit. Run on every branch:
 *   npm run content:trivia:check
 * Only require every question to be finished at final content-release sign-off:
 *   npm run content:trivia:complete
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSlate, type Slate } from '../src/content/schema.ts';
import { auditFunFacts, auditReserveSpoilers, type NBAContext } from '../src/content/fun-fact-audit.ts';
import { loadNbaData } from './nba/model.ts';

const dir = join(import.meta.dirname, '..', 'content', 'days');
const slates: Slate[] = readdirSync(dir)
  .filter((p) => p.endsWith('.json'))
  .sort()
  .map((p) => parseSlate(JSON.parse(readFileSync(join(dir, p), 'utf8'))));
const result = auditFunFacts(slates);
// The first editorial milestone is the 52 original slates, not the later expansion.
// Keep this scoped gate independent of the eventual 510-question completeness gate.
const originalSlates = slates.filter((slate) =>
  slate.date >= '2026-11-15' && slate.date <= '2027-01-05',
);
const original = auditFunFacts(originalSlates);
const originalDates = new Set(originalSlates.map((slate) => slate.date));
const originalMissingDates: string[] = [];
for (let day = Date.UTC(2026, 10, 15); day <= Date.UTC(2027, 0, 5); day += 86_400_000) {
  const date = new Date(day).toISOString().slice(0, 10);
  if (!originalDates.has(date)) originalMissingDates.push(date);
}
console.log(`Original slate coverage: ${original.coveredQuestions}/260 questions; ${original.verifiedVariants}/780 variants across ${originalSlates.length}/52 dates`);
if (original.missingQuestionIds.length)
  console.log(`Next original missing: ${original.missingQuestionIds.slice(0, 10).join(', ')}`);
if (originalMissingDates.length)
  console.error(`ERROR: missing original dates: ${originalMissingDates.join(', ')}`);
const nba = loadNbaData();
const meta: NBAContext[] = nba.facts.map((f) => ({
  id: f.id, player: f.player, franchise: f.franchise, season: f.season,
  answer: f.answer, step: f.question.step,
}));
const byId = new Map(meta.map((f) => [f.id, f]));
const reserve = nba.calendar.reserve.map((id) => {
  const f = byId.get(id);
  if (!f) throw new Error(`Unknown reserve ${id}`);
  return f;
});
const reserveErrors = auditReserveSpoilers(slates, byId, reserve);
console.log(`Bonus fact coverage: ${result.coveredQuestions}/${result.totalQuestions} questions; ${result.verifiedVariants} source-backed variants`);
console.log(`Unreviewed: ${result.missingQuestionIds.length} questions`);
if (result.missingQuestionIds.length) {
  console.log(`Next missing: ${result.missingQuestionIds.slice(0, 10).join(', ')}`);
}
for (const error of [...result.errors, ...reserveErrors]) console.error(`ERROR: ${error}`);
if (result.errors.length || reserveErrors.length ||
  (process.argv.includes('--require-original') && (originalMissingDates.length || original.totalQuestions !== 260 || original.missingQuestionIds.length || original.errors.length)) ||
  (process.argv.includes('--require-complete') && result.missingQuestionIds.length)) process.exitCode = 1;
