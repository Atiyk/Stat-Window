/**
 * Creates the next empty daily slate to fill in.
 *   npm run content:new            -> next day after the last published slate
 *   npm run content:new 2026-12-01 -> a specific date
 * The template fails validation on purpose until every field is filled in and checked.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays } from '../src/engine/daily.ts';

const dir = join(import.meta.dirname, '..', 'content', 'days');
const last = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().at(-1)?.slice(0, 10);
const date = process.argv[2] ?? (last ? addDays(last, 1) : new Date().toISOString().slice(0, 10));
const file = join(dir, `${date}.json`);
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}

const blank = (n: number) => ({
  id: `TODO-${date}-${n}`,
  sport: 'TODO',
  prompt: 'TODO: one unambiguous question with a single numeric answer?',
  context: 'TODO: league · team · season',
  answer: 0,
  unit: { singular: 'TODO', plural: 'TODOs' },
  min: 0,
  max: 0,
  step: 1,
  note: 'TODO: one sentence that tells the story behind the number.',
  source: { name: 'TODO', url: 'https://TODO', quote: 'TODO: the sentence on that page that states the number' },
  verified: { on: new Date().toISOString().slice(0, 10), by: 'TODO: your name' },
});

writeFileSync(file, `${JSON.stringify({ date, questions: [1, 2, 3, 4, 5].map(blank) }, null, 2)}\n`);
console.log(`Created ${file}. Fill it in, then run: npm run content:check`);
