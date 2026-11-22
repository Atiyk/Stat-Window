/**
 * Writes public/remind/00.ics … 22.ics (one per offered UTC hour) from src/engine/remind.ts and
 * removes any other file there. src/engine/remind.test.ts fails if a committed file differs.
 *
 *   npm run remind:ics
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { icsText, REMIND_HOURS } from '../src/engine/remind.ts';

const dir = join(import.meta.dirname, '..', 'public', 'remind');
const want = new Map(REMIND_HOURS.map((h) => [`${String(h).padStart(2, '0')}.ics`, icsText(h)]));
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (!want.has(f)) rmSync(join(dir, f));
for (const [f, body] of want) writeFileSync(join(dir, f), body);
console.log(`public/remind: ${want.size} files written.`);
