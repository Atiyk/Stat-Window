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
 *
 * Version 2 (`&v=2&r=48.61.0.100.38`) adds the sender's five round scores for the
 * friend race (docs/V5.md). They must be five whole numbers from 0 to 100 that add
 * up to `vs`; otherwise every friend score is dropped, but the day still opens.
 */

export type ChallengeLink =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'future' }
  | { kind: 'day'; day: string; vs: number | null; vsTime: number | null; rounds?: number[] };

/** Link versions. No `v` is the original final-total link; `v=2` adds the five round scores. */
export const RACE_LINK_VERSION = '2';
const MAX_SEARCH = 600;
const ROUND = /^(0|[1-9]\d?|100)$/;

/** Five dot-separated whole numbers from 0 to 100, or null. */
export function parseRounds(raw: string): number[] | null {
  const parts = raw.split('.');
  if (parts.length !== 5 || !parts.every((p) => ROUND.test(p))) return null;
  return parts.map(Number);
}

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
  const days = params.getAll('day');
  if (days.length === 0) return { kind: 'none' };
  if (days.length > 1) return { kind: 'invalid' };
  const day = days[0]!;
  if (!isRealDay(day)) return { kind: 'invalid' };
  if (day > today) return { kind: 'future' };
  if (!published.includes(day)) return { kind: 'invalid' };
  const plain = { kind: 'day', day, vs: null, vsTime: null } as const;
  // A mangled or padded link still opens the same five questions, without any friend score.
  if (search.length > MAX_SEARCH) return plain;
  if (['vs', 'time', 'v', 'r'].some((k) => params.getAll(k).length > 1)) return plain;
  const time = params.get('time');
  const vsTime = time && /^\d{1,6}$/.test(time) && Number(time) <= 120_000 ? Number(time) : null;
  const vs = parseScore(params.get('vs'));
  const v = params.get('v');
  const r = params.get('r');
  if (v === null && r === null) return { kind: 'day', day, vs, vsTime };
  if (v !== RACE_LINK_VERSION || r === null || vs === null) return plain;
  const rounds = parseRounds(r);
  if (!rounds || rounds.reduce((a, b) => a + b, 0) !== vs) return plain;
  return { kind: 'day', day, vs, vsTime, rounds };
}

export function challengeUrl(origin: string, day: string, total?: number, answerMs?: number | null, rounds?: readonly number[]): string {
  const u = new URL('/', origin);
  u.searchParams.set('day', day);
  if (total !== undefined) u.searchParams.set('vs', String(total));
  if (answerMs !== undefined && answerMs !== null) u.searchParams.set('time', String(Math.round(answerMs)));
  // Round scores go out only when they are well formed and add up to the total.
  if (total !== undefined && rounds && parseRounds(rounds.join('.')) && rounds.reduce((a, b) => a + b, 0) === total) {
    u.searchParams.set('v', RACE_LINK_VERSION);
    u.searchParams.set('r', rounds.join('.'));
  }
  return u.toString();
}
