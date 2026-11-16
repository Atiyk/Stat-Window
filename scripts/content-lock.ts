/**
 * Records each slate's scoring fingerprint (ids, answers, scales, order) in
 * content/published.lock.json. Refuses to rewrite a day that is already published.
 *   node --experimental-strip-types scripts/content-lock.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextLock, parseSlate, type ContentLock } from '../src/content/schema.ts';
import { puzzleDay } from '../src/engine/daily.ts';

const root = join(import.meta.dirname, '..', 'content');
// Always today's real UTC date: a --today override could unlock published days.
const today = puzzleDay(new Date());
const lockFile = join(root, 'published.lock.json');
let lock: ContentLock = {};
try {
  lock = JSON.parse(readFileSync(lockFile, 'utf8')) as ContentLock;
} catch {
  /* first run */
}
const slates = readdirSync(join(root, 'days'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseSlate(JSON.parse(readFileSync(join(root, 'days', f), 'utf8'))));
const { lock: next, refused } = nextLock(slates, lock, today);
for (const day of refused) console.error(`refused: ${day} is published; restore its ids, answers, scales and order`);
writeFileSync(lockFile, JSON.stringify(next, null, 2) + '\n');
console.log(`Locked ${Object.keys(next).length} days.`);
if (refused.length) process.exit(1);
