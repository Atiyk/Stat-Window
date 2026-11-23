/**
 * Browser side of the daily comparison (server: server/api.ts, spec: docs/PERCENTILES.md).
 * Every call fails soft: the game, the score and sharing never wait on it.
 */
import type { RoundRecord } from '../engine/game';
import { midrankPercentile, emptyDistribution, PERCENTILE_MIN_SAMPLE } from '../engine/percentile';
import { loadPrivacy, newKey, savePrivacy, scoreKey } from './privacy';

export type Comparison =
  | { kind: 'ready'; percentile: number; n: number; score: number; asOf: string }
  | { kind: 'gathering'; n: number; threshold: number; score: number; asOf: string }
  | { kind: 'consent' }
  | { kind: 'ineligible' }
  | { kind: 'disabled' }
  | { kind: 'unavailable' };

type ApiBody = {
  status?: string;
  n?: number;
  threshold?: number;
  ready?: boolean;
  score?: number;
  percentile?: { rounded: number } | null;
  counts?: Record<string, number>;
  asOf?: string;
  /** The number of linked scores removed by a confirmed DELETE (zero is valid). */
  removed?: number;
};

const ENDPOINT = '/api/scores';
/** The published build never shows a percentile from fewer than 100 games, whatever a server says. */
const FLOOR = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ? 0 : PERCENTILE_MIN_SAMPLE;

/** QA runs (`?qa=1` once, remembered) go to a separate season that never reaches real rankings. */
export function isQa(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('qa') === '1') window.localStorage.setItem('stat-window:qa', '1');
    return window.localStorage.getItem('stat-window:qa') === '1';
  } catch {
    return false;
  }
}

function toComparison(status: number, b: ApiBody | null): Comparison {
  // Revoked browser keys must not be mistaken for a request to give consent.
  if (b?.status === 'revoked') return { kind: 'disabled' };
  if (status === 409 || b?.status === 'consent-required') return { kind: 'consent' };
  if (b?.status === 'ineligible') return { kind: 'ineligible' };
  if (b?.status === 'disabled' || status === 404 || status === 405) return { kind: 'disabled' };
  if ((b?.status === 'stored' || b?.status === 'duplicate') && typeof b.n === 'number' && typeof b.score === 'number') {
    const asOf = b.asOf ?? new Date().toISOString();
    const threshold = Math.max(b.threshold ?? PERCENTILE_MIN_SAMPLE, FLOOR);
    if (b.ready && b.percentile && b.n >= threshold) return { kind: 'ready', percentile: b.percentile.rounded, n: b.n, score: b.score, asOf };
    return { kind: 'gathering', n: b.n, threshold, score: b.score, asOf };
  }
  return { kind: 'unavailable' };
}

async function call(method: 'POST' | 'DELETE', body: unknown, fetchImpl: typeof fetch): Promise<[number, ApiBody | null]> {
  const res = await fetchImpl(ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  return [res.status, (await res.json().catch(() => null)) as ApiBody | null];
}

/**
 * Sends a finished official daily (first completion wins on the server, so a retry,
 * a refresh or a second tab is safe). Only the five windows go up, never answers
 * typed text or the URL; the server re-scores them.
 */
export async function submitDaily(
  opts: { day: string; results: readonly RoundRecord[]; consent: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<Comparison> {
  if (opts.results.length !== 5) return { kind: 'ineligible' };
  if (loadPrivacy().deleting || loadPrivacy().scores === 'off') return { kind: 'disabled' };
  const total = opts.results.reduce((s, r) => s + r.points, 0);
  // Already counted (first completion wins): just read the tally, which the edge caches.
  // Not in QA: the GET reads the public season's tally, while QA scores go to the 'qa' season,
  // so QA sends the run again and reads its own tally from the 'duplicate' answer instead.
  if (loadPrivacy().done.includes(opts.day) && !isQa()) return refreshComparison(opts.day, total, fetchImpl);
  try {
    const consent = opts.consent ? 'granted' : 'default';
    if (!opts.consent) {
      // Ask the server whether this location needs a yes first, sending nothing identifying:
      // no key is made or sent, and no windows, until the answer is "go ahead".
      const [status, b] = await call('POST', { day: opts.day, consent }, fetchImpl);
      if (b?.status !== 'proceed') {
        const c = toComparison(status, b);
        if (c.kind === 'consent') savePrivacy({ asked: true });
        return c;
      }
    }
    if (loadPrivacy().deleting || loadPrivacy().scores === 'off') return { kind: 'disabled' };
    const player = scoreKey();
    const body = {
      day: opts.day,
      player,
      rounds: opts.results.map((r) => ({ id: r.questionId, lo: r.lo, hi: r.hi })),
      total,
      consent,
      ...(isQa() ? { test: true } : {}),
    };
    // Recorded before sending, so a lost response can't leave a stored score that "Delete" doesn't know about.
    const sent = loadPrivacy().sent;
    if (!sent.includes(opts.day)) savePrivacy({ sent: [...sent, opts.day] });
    if (loadPrivacy().deleting || loadPrivacy().scores === 'off') return { kind: 'disabled' };
    const [status, b] = await call('POST', body, fetchImpl);
    const latest = loadPrivacy();
    if (latest.deleting || latest.scores === 'off' || latest.key !== player) return { kind: 'disabled' };
    const c = toComparison(status, b);
    const done = loadPrivacy().done;
    if ((c.kind === 'ready' || c.kind === 'gathering') && !done.includes(opts.day)) savePrivacy({ done: [...done, opts.day] });
    return c;
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Re-reads today's distribution (cached at the edge for a few minutes) for a score already submitted. */
export async function refreshComparison(day: string, score: number, fetchImpl: typeof fetch = fetch): Promise<Comparison> {
  try {
    const res = await fetchImpl(`${ENDPOINT}?day=${encodeURIComponent(day)}`, { credentials: 'omit', signal: AbortSignal.timeout(6000) });
    const b = (await res.json().catch(() => null)) as ApiBody | null;
    if (!res.ok || b?.status !== 'ok' || typeof b.n !== 'number') return toComparison(res.status, b);
    const asOf = b.asOf ?? new Date().toISOString();
    const threshold = Math.max(b.threshold ?? PERCENTILE_MIN_SAMPLE, FLOOR);
    if (!b.ready || !b.counts || b.n < threshold) return { kind: 'gathering', n: b.n, threshold, score, asOf };
    const counts = emptyDistribution();
    for (const [s, c] of Object.entries(b.counts)) if (/^\d{1,3}$/.test(s) && Number(s) <= 500) counts[Number(s)] = c;
    const p = midrankPercentile(counts, score);
    return p ? { kind: 'ready', percentile: p.rounded, n: p.n, score, asOf } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Deletes every score this browser sent that the server still links to it, then forgets the key. */
export async function deleteMyScores(fetchImpl: typeof fetch = fetch): Promise<'deleted' | 'nothing' | 'failed'> {
  const p = loadPrivacy();
  // Withdrawing consent is immediate; never lose the original code or known
  // submission days until the server confirms deletion. Retry is always safe.
  savePrivacy({ scores: 'off', deleting: !!p.key });
  if (!p.key) {
    // Without a code we cannot claim to have erased known linked submissions.
    if (p.sent.length > 0) return 'failed';
    savePrivacy({ key: null, sent: [], done: [], scores: 'off', deleting: false });
    return 'nothing';
  }
  if (p.sent.length === 0 && !p.deleting) {
    // A newly rotated key that has never been submitted has no server-side
    // score to erase. Do not spend a Redis write or falsely report deletion.
    savePrivacy({ key: null, sent: [], done: [], scores: 'off', deleting: false });
    return 'nothing';
  }
  try {
    const [status, body] = await call('DELETE', { player: p.key, days: p.sent }, fetchImpl);
    const removed = body?.removed;
    if (status !== 200 || body?.status !== 'ok' || typeof removed !== 'number'
        || !Number.isInteger(removed) || removed < 0) return 'failed';
    // Another tab may have replaced the code while this request was in flight.
    if (loadPrivacy().key !== p.key) return 'failed';
    savePrivacy({ key: newKey(), sent: [], done: [], scores: 'off', deleting: false });
    return 'deleted';
  } catch {
    return 'failed';
  }
}
