import type { Question } from '../content/schema';

const KEY = 'stat-window:fun-fact-seed:v1';
let sessionSeed: string | null = null;

/** Browser-local only: no identity, tracking or server request. */
export function browserFunFactSeed(): string {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored && /^[a-f0-9]{16}$/.test(stored)) return stored;
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    const seed = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(KEY, seed);
    return seed;
  } catch {
    // Blocked storage still works; seed is only stable for this page session.
    sessionSeed ??= Math.random().toString(36).slice(2);
    return sessionSeed;
  }
}

/** Deterministic variant per browser per question, without a network call. */
export function funFactIndex(questionId: string, count: number, seed: string): number {
  if (!Number.isInteger(count) || count <= 0) return -1;
  let hash = 2166136261;
  for (const char of `${seed}:${questionId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

export function pickFunFact(question: Pick<Question, 'id' | 'funFacts'>, seed: string) {
  const facts = question.funFacts;
  return facts?.[funFactIndex(question.id, facts.length, seed)] ?? null;
}
