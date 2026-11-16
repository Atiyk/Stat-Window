import { MAX_TOTAL } from './summary';

/**
 * Same-puzzle links. A shared result carries the puzzle's canonical UTC date
 * (`?day=2026-11-16`) and, optionally, the sender's total (`&vs=312`), so a friend
 * who opens it after midnight UTC still gets the same five questions.
 *
 * Nothing in the URL is trusted: the day must be a real, published slate that is
 * not in the future (a future date would leak a puzzle early), and the score must
 * be a whole number from 0 to 500. Anything else is ignored and the visitor gets
 * today's puzzle, so old bare links and mangled ones keep working.
 */

export type ChallengeLink =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'future' }
  | { kind: 'day'; day: string; vs: number | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseScore(raw: string | null): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_TOTAL ? n : null;
}

export function parseChallenge(search: string, today: string, published: readonly string[]): ChallengeLink {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { kind: 'invalid' };
  }
  const day = params.get('day');
  if (day === null) return { kind: 'none' };
  if (!isRealDay(day)) return { kind: 'invalid' };
  if (day > today) return { kind: 'future' };
  if (!published.includes(day)) return { kind: 'invalid' };
  return { kind: 'day', day, vs: parseScore(params.get('vs')) };
}

export function challengeUrl(origin: string, day: string, total?: number): string {
  const u = new URL('/', origin);
  u.searchParams.set('day', day);
  if (total !== undefined) u.searchParams.set('vs', String(total));
  return u.toString();
}
