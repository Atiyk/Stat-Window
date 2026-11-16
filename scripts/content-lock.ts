/**
 * Records each slate's scoring fingerprint (ids, answers, scales, order) in
 * content/published.lock.json. Refuses to rewrite a day that is already published.
 *   node --experimental-strip-types scripts/content-lock.ts [--today YYYY-MM-DD]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSlate, scoringFingerprint, type ContentLock } from '../src/content/schema.ts';
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
const next: ContentLock = {};
let refused = 0;
for (const file of readdirSync(join(root, 'days')).filter((f) => f.endsWith('.json')).sort()) {
  const slate = parseSlate(JSON.parse(readFileSync(join(root, 'days', file), 'utf8')));
  const fp = scoringFingerprint(slate);
  const old = lock[slate.date];
  if (old && slate.date <= today && JSON.stringify(old) !== JSON.stringify(fp)) {
    console.error(`refused: ${slate.date} is published; restore its ids, answers, scales and order`);
    next[slate.date] = old;
    refused++;
  } else {
    next[slate.date] = fp;
  }
}
writeFileSync(lockFile, JSON.stringify(next, null, 2) + '\n');
console.log(`Locked ${Object.keys(next).length} days.`);
if (refused) process.exit(1);
