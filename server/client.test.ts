/**
 * The browser client against the real server handler (in-memory store), so the
 * contract between them is tested end to end without a network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, handle } from './api.ts';
import { DAY, NOON, roundsFor, testContext } from './fixtures.ts';
import type { RoundRecord } from '../src/engine/game.ts';
import { loadPrivacy, savePrivacy } from '../src/lib/privacy.ts';
import { deleteMyScores, refreshComparison, submitDaily } from '../src/lib/scores.ts';

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
    expect(loadPrivacy().key).not.toBe(key);
    // Deleting also stops: the next results screen must not send the same day again.
    expect(loadPrivacy().scores).toBe('off');
    expect(await deleteMyScores(fetchFor(ctx))).toBe('nothing');
    savePrivacy({ sent: [DAY], key: 'a'.repeat(22) });
    const down = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    expect(await deleteMyScores(down)).toBe('failed');
  });
});
