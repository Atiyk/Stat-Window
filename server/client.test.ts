/**
 * The browser client against the real server handler (in-memory store), so the
 * contract between them is tested end to end without a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, handle } from './api.ts';
import { DAY, NOON, roundsFor, testContext } from './fixtures.ts';
import type { RoundRecord } from '../src/engine/game.ts';
import { loadPrivacy, savePrivacy } from '../src/lib/privacy.ts';
import { CROWD_STALE_MS, deleteMyScores, prefetchQuestionCrowd, questionCrowdFor, refreshComparison, resetQuestionCrowd, submitDaily } from '../src/lib/scores.ts';
import { questionCrowdLine } from '../src/engine/percentile.ts';

const mem = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
  location: { search: '' },
});

function fetchFor(ctx: Parameters<typeof handle>[1], country = 'US'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('x-vercel-ip-country', country);
    headers.set('host', 'stat-window.vercel.app');
    return handle(new Request(new URL(String(input), 'https://stat-window.vercel.app'), { ...init, headers }), ctx);
  }) as typeof fetch;
}

async function records(width: number): Promise<RoundRecord[]> {
  const { rounds, slate } = await roundsFor(DAY, width);
  const { scoreWindow } = await import('../src/engine/scoring.ts');
  return rounds.map((r, i) => ({ questionId: r.id, lo: r.lo, hi: r.hi, ...scoreWindow(slate.questions[i]!, r) }));
}

beforeEach(() => mem.clear());

describe('submitDaily → server → comparison', () => {
  it('stores once, remembers the day for deletion, and shows "gathering" below the gate', async () => {
    const { ctx } = testContext();
    const results = await records(2);
    const first = await submitDaily({ day: DAY, results, consent: false }, fetchFor(ctx));
    expect(first).toMatchObject({ kind: 'gathering', n: 1, threshold: 100 });
    expect(loadPrivacy().sent).toEqual([DAY]);
    // Later visits only read the (edge-cached) tally instead of submitting again.
    let methods: string[] = [];
    const f = fetchFor(ctx);
    const again = await submitDaily({ day: DAY, results, consent: false }, ((i: RequestInfo | URL, init?: RequestInit) => (methods.push(init?.method ?? 'GET'), f(i, init))) as typeof fetch);
    expect(again).toMatchObject({ kind: 'gathering', n: 1 });
    expect(methods).toEqual(['GET']);
    methods = [];
  });

  it('crossing the gate gives a midrank percentile, and refresh recomputes it from the cached distribution', async () => {
    const { ctx } = testContext({ minSample: 3, limits: { ...DEFAULT_LIMITS, subTtl: 604800, distTtl: 1e7, dailyBudget: 1000, ratePerMinute: 100 } });
    for (const w of [20, 10]) {
      mem.clear();
      await submitDaily({ day: DAY, results: await records(w), consent: false }, fetchFor(ctx));
    }
    mem.clear();
    const mine = await records(1);
    const c = await submitDaily({ day: DAY, results: mine, consent: false }, fetchFor(ctx));
    expect(c).toMatchObject({ kind: 'ready', n: 3 });
    if (c.kind !== 'ready') return;
    const r = await refreshComparison(DAY, c.score, fetchFor(ctx));
    expect(r).toMatchObject({ kind: 'ready', percentile: c.percentile, n: 3 });
  });

  it('asks for consent where required and stores only after a yes', async () => {
    const { ctx } = testContext();
    const results = await records(2);
    const bodies: unknown[] = [];
    const spy = fetchFor(ctx, 'FR');
    const watching = ((input: RequestInfo | URL, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body ?? 'null'))), spy(input, init))) as typeof fetch;
    expect(await submitDaily({ day: DAY, results, consent: false }, watching)).toEqual({ kind: 'consent' });
    // Before a yes: no key is made, and nothing identifying or gameplay-related is sent.
    expect(bodies).toEqual([{ day: DAY, consent: 'default' }]);
    expect(loadPrivacy()).toMatchObject({ key: null, sent: [], asked: true });
    expect(await submitDaily({ day: DAY, results, consent: true }, fetchFor(ctx, 'FR'))).toMatchObject({ kind: 'gathering' });
  });

  it('a past day is ineligible and an unconfigured server hides the feature', async () => {
    const { ctx } = testContext({}, { t: NOON.getTime() + 2 * 86_400_000 });
    expect(await submitDaily({ day: DAY, results: await records(2), consent: false }, fetchFor(ctx))).toEqual({ kind: 'ineligible' });
    const { ctx: off } = testContext({ enabled: false });
    expect(await submitDaily({ day: DAY, results: await records(2), consent: false }, fetchFor(off))).toEqual({ kind: 'disabled' });
  });

  it('never submits a score when the browser cannot persist a recoverable erasure key', async () => {
    const original = window.localStorage;
    const readOnly = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
    const requests: RequestInit[] = [];
    const request = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      throw new Error('must not reach the API');
    }) as typeof fetch;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: readOnly });
    try {
      expect(await submitDaily({ day: DAY, results: await records(2), consent: true }, request)).toEqual({ kind: 'unavailable' });
      expect(requests).toHaveLength(0);
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
    }
  });

  it('offline or failing network never throws', async () => {
    const down = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    expect(await submitDaily({ day: DAY, results: await records(2), consent: false }, down)).toEqual({ kind: 'unavailable' });
    expect(await refreshComparison(DAY, 10, down)).toEqual({ kind: 'unavailable' });
    expect(await submitDaily({ day: DAY, results: [], consent: false }, down)).toEqual({ kind: 'ineligible' });
  });

  it('delete removes this browser’s record, rotates the key and clears the list', async () => {
    const { ctx } = testContext();
    await submitDaily({ day: DAY, results: await records(2), consent: false }, fetchFor(ctx));
    const key = loadPrivacy().key;
    expect(await deleteMyScores(fetchFor(ctx))).toBe('deleted');
    expect(loadPrivacy().sent).toEqual([]);
    expect(loadPrivacy().key).toBeNull(); // no unused code to revoke until the next opt-in
    // Deleting also stops: the next results screen must not send the same day again.
    expect(loadPrivacy().scores).toBe('off');
    expect(await deleteMyScores(fetchFor(ctx))).toBe('nothing');
    savePrivacy({ sent: [DAY], key: 'a'.repeat(22) });
    const down = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    expect(await deleteMyScores(down)).toBe('failed');
  });
});

describe('question comparison in the browser: one cached read, never in the way', () => {
  const roomy = { ...DEFAULT_LIMITS, ratePerMinute: 1000, ipDailyStored: 1000, ipDailyCalls: 1000, dailyBudget: 100_000 };
  const counting = (f: typeof fetch) => {
    const calls: string[] = [];
    const wrapped = ((i: RequestInfo | URL, init?: RequestInit) => (calls.push(`${init?.method ?? 'GET'} ${String(i)}`), f(i, init))) as typeof fetch;
    return { calls, wrapped };
  };
  async function seeded() {
    const { ctx } = testContext({ minSample: 2, limits: roomy });
    for (const w of [2, 3]) {
      mem.clear();
      await submitDaily({ day: DAY, results: await records(w), consent: false }, fetchFor(ctx));
    }
    mem.clear();
    return ctx;
  }
  beforeEach(() => {
    resetQuestionCrowd();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });
  afterEach(() => vi.useRealTimers());

  it('reads once per day per page, however many rounds ask, and serves each question only for its own id', async () => {
    const ctx = await seeded();
    const { calls, wrapped } = counting(fetchFor(ctx));
    await Promise.all([prefetchQuestionCrowd(DAY, wrapped), prefetchQuestionCrowd(DAY, wrapped)]);
    await prefetchQuestionCrowd(DAY, wrapped);
    expect(calls).toEqual([`GET /api/scores?day=${DAY}`]);
    const ids = (await records(2)).map((r) => r.questionId);
    const s = questionCrowdFor(DAY, 0, ids[0]!);
    expect(s).toMatchObject({ n: 2, ready: true });
    expect(questionCrowdLine(s, 0, 2)).toBeNull(); // two games: shares stay suppressed (small cells)
    expect(questionCrowdLine(s, 50, 2)).toBeNull(); // two scoring games: the table is a small cell too
    expect(questionCrowdFor(DAY, 0, ids[1]!)).toBeNull();
    expect(questionCrowdFor(DAY, 7, ids[0]!)).toBeNull();
  });

  it('is withheld when stale, before the server gate, after "No thanks", in QA, or for another day', async () => {
    const ctx = await seeded();
    await prefetchQuestionCrowd(DAY, fetchFor(ctx));
    const id = (await records(2))[0]!.questionId;
    expect(questionCrowdFor(DAY, 0, id)).not.toBeNull();
    expect(questionCrowdFor(DAY, 0, id, NOON.getTime() + CROWD_STALE_MS + 1)).toBeNull();
    savePrivacy({ scores: 'off' });
    expect(questionCrowdFor(DAY, 0, id)).toBeNull();
    resetQuestionCrowd();
    const { calls, wrapped } = counting(fetchFor(ctx));
    await prefetchQuestionCrowd(DAY, wrapped);
    expect(calls).toEqual([]); // declined: not even an anonymous read
    savePrivacy({ scores: 'unset' });
    mem.set('stat-window:qa', '1');
    await prefetchQuestionCrowd(DAY, wrapped);
    expect(calls).toEqual([]);
    mem.delete('stat-window:qa');
    await prefetchQuestionCrowd('2026-11-10', wrapped);
    expect(calls).toEqual([]);
    const { ctx: gated } = testContext({ minSample: 3, limits: roomy });
    for (const w of [2, 3]) {
      mem.clear();
      await submitDaily({ day: DAY, results: await records(w), consent: false }, fetchFor(gated));
    }
    mem.clear();
    resetQuestionCrowd();
    await prefetchQuestionCrowd(DAY, fetchFor(gated));
    expect(questionCrowdFor(DAY, 0, id)).toBeNull();
  });

  it('GPC, Do Not Track, an ask-first location or a pending deletion mean no read and no line', async () => {
    const ctx = await seeded();
    const id = (await records(2))[0]!.questionId;
    const original = globalThis.navigator;
    const restore = () => vi.stubGlobal('navigator', original);
    const { calls, wrapped } = counting(fetchFor(ctx));
    for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
      vi.stubGlobal('navigator', nav);
      resetQuestionCrowd();
      await prefetchQuestionCrowd(DAY, wrapped);
      expect(questionCrowdFor(DAY, 0, id)).toBeNull();
      restore();
    }
    for (const prefs of [{ scores: 'unset', asked: true }, { scores: 'on', deleting: true }] as const) {
      savePrivacy(prefs);
      resetQuestionCrowd();
      await prefetchQuestionCrowd(DAY, wrapped);
      expect(questionCrowdFor(DAY, 0, id)).toBeNull();
    }
    expect(calls).toEqual([]);
    // A signal that appears after a read was made also withholds the line already fetched.
    mem.clear();
    resetQuestionCrowd();
    await prefetchQuestionCrowd(DAY, fetchFor(ctx));
    expect(questionCrowdFor(DAY, 0, id)).not.toBeNull();
    vi.stubGlobal('navigator', { globalPrivacyControl: true });
    expect(questionCrowdFor(DAY, 0, id)).toBeNull();
    restore();
  });

  it('offline, paused, disabled or malformed answers mean no line and no error', async () => {
    const id = (await records(2))[0]!.questionId;
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('offline')),
      async () => new Response('{"status":"paused"}', { status: 503 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response(JSON.stringify({ status: 'ok', day: DAY, n: 500, threshold: 100, asOf: NOON.toISOString(), questions: [{ id, n: 500, ready: true, pct: [1, 2] }, 1, 2, 3, 4] })),
      async () => new Response(JSON.stringify({ status: 'ok', day: '2026-11-17', n: 500, threshold: 100, asOf: NOON.toISOString(), questions: [] })),
      async () => new Response(JSON.stringify({ status: 'ok', day: DAY, n: 500, threshold: 100, asOf: NOON.toISOString(), questions: null })),
    ];
    for (const answer of answers) {
      resetQuestionCrowd();
      await expect(prefetchQuestionCrowd(DAY, answer as unknown as typeof fetch)).resolves.toBeUndefined();
      expect(questionCrowdFor(DAY, 0, id)).toBeNull();
    }
  });

  it('the results screen’s refresh read fills the same cache, so no extra request is made', async () => {
    const ctx = await seeded();
    const { calls, wrapped } = counting(fetchFor(ctx));
    await refreshComparison(DAY, 100, wrapped);
    await prefetchQuestionCrowd(DAY, wrapped);
    expect(calls).toHaveLength(1);
    expect(questionCrowdFor(DAY, 0, (await records(2))[0]!.questionId)).not.toBeNull();
  });
});
