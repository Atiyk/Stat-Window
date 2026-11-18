import { contextFromEnv, type ApiContext, type ServerSlate } from './api.ts';
import { fileSlates } from './slates.ts';
import { memoryStore } from './store.ts';
import { scoreWindow } from '../src/engine/scoring.ts';

export const DAY = '2026-11-18';
export const NOON = new Date(`${DAY}T12:00:00Z`);

export function testContext(over: Partial<ApiContext> = {}, nowRef = { t: NOON.getTime() }) {
  const store = memoryStore(() => nowRef.t);
  const ctx: ApiContext = {
    ...contextFromEnv({ SCORES_ENABLED: '1', SCORE_HASH_SECRET: 'test-secret' }, { store, loadSlate: fileSlates() }),
    now: () => new Date(nowRef.t),
    ...over,
  };
  return { ctx, store, nowRef };
}

/** A window of `width` steps that contains (hit) or just misses the answer. */
export function windowFor(q: ServerSlate['questions'][number], width: number, hit = true) {
  const steps = Math.round((q.max - q.min) / q.step);
  const a = Math.round((q.answer - q.min) / q.step);
  width = Math.min(width, steps - 1);
  let lo = hit ? Math.max(0, Math.min(a, steps - width)) : a + 1;
  if (!hit && lo + width > steps) lo = Math.max(0, a - 1 - width);
  const d = (String(q.step).split('.')[1] ?? '').length;
  const v = (s: number) => Number((q.min + s * q.step).toFixed(d));
  return { id: q.id, lo: v(lo), hi: v(lo + width) };
}

export async function roundsFor(day: string, width: number | number[], hit: boolean | boolean[] = true) {
  const slate = (await fileSlates()(day))!;
  const rounds = slate.questions.map((q, i) => windowFor(q, Array.isArray(width) ? width[i]! : width, Array.isArray(hit) ? hit[i]! : hit));
  const total = slate.questions.reduce((s, q, i) => s + scoreWindow(q, rounds[i]!).points, 0);
  return { rounds, total, slate };
}

export const player = (n: number) => `p${String(n).padStart(21, '0')}`;

export function post(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://stat-window.vercel.app/api/scores', {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://stat-window.vercel.app', host: 'stat-window.vercel.app', 'x-vercel-ip-country': 'US', 'x-real-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
