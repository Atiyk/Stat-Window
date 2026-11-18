import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerSlate } from './api.ts';

/** Reads a published day file (bundled into the function via vercel.json includeFiles). */
export function fileSlates(root = process.cwd()) {
  const cache = new Map<string, ServerSlate | null>();
  return async (day: string): Promise<ServerSlate | null> => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    if (cache.has(day)) return cache.get(day)!;
    let slate: ServerSlate | null = null;
    try {
      const raw = JSON.parse(await readFile(path.join(root, 'content', 'days', `${day}.json`), 'utf8')) as ServerSlate;
      const ok =
        raw.date === day &&
        Array.isArray(raw.questions) &&
        raw.questions.length === 5 &&
        raw.questions.every((q) => typeof q.id === 'string' && [q.answer, q.min, q.max, q.step].every((n) => typeof n === 'number' && Number.isFinite(n)) && q.step > 0);
      slate = ok ? { date: raw.date, questions: raw.questions.map(({ id, answer, min, max, step }) => ({ id, answer, min, max, step })) } : null;
    } catch {
      slate = null;
    }
    cache.set(day, slate);
    return slate;
  };
}
