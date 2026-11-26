/**
 * Day-by-day format report for the official season (every day from VARIETY_FROM).
 *   node --experimental-strip-types scripts/nba/variety-report.ts
 */
import { formatPattern, slateFormatIssues, VARIETY_FROM } from '../../src/content/formats.ts';
import { loadNbaData } from './model.ts';

const { facts, calendar } = loadNbaData();
const by = new Map(facts.map((f) => [f.id, f]));
const rows = calendar.days.filter((d) => d.date >= VARIETY_FROM).map((d) => {
  const formats = d.questions.map((id) => by.get(id)?.question.format?.kind ?? 'recall');
  return { date: d.date, formats, pattern: formatPattern(formats), ok: slateFormatIssues(formats).length === 0 };
});
console.log('| Day | Q1 | Q2 | Q3 | Q4 | Q5 | Mix |\n| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.date} | ${r.formats.join(' | ')} | ${r.pattern}${r.ok ? '' : ' (INVALID)'} |`);
console.log(`\n${rows.length} official days, ${rows.filter((r) => r.ok).length} valid.`);
