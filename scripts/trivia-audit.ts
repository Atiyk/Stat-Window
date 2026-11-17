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
  (process.argv.includes('--require-complete') && result.missingQuestionIds.length)) process.exitCode = 1;
