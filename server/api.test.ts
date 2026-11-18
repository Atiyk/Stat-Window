import { describe, expect, it } from 'vitest';
import { contextFromEnv, DEFAULT_LIMITS, eligibleDay, handle, ipPrefix, verifyRounds } from './api.ts';
import { COST, memoryStore, type ScoreStore } from './store.ts';
import { fileSlates } from './slates.ts';
import { DAY, NOON, player, post, roundsFor, testContext } from './fixtures.ts';

const submit = async (ctx: Parameters<typeof handle>[1], body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handle(post(body, headers), ctx);
  return { code: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('eligibility from the server clock', () => {
  it('accepts today, and yesterday only in the two hours after midnight UTC', () => {
    expect(eligibleDay(DAY, NOON, 7200)).toBe(true);
    expect(eligibleDay('2026-11-17', NOON, 7200)).toBe(false);
    expect(eligibleDay('2026-11-17', new Date(`${DAY}T01:59:00Z`), 7200)).toBe(true);
    expect(eligibleDay('2026-11-17', new Date(`${DAY}T02:00:00Z`), 7200)).toBe(false);
    expect(eligibleDay('2026-11-19', NOON, 7200)).toBe(false);
  });
});

describe('server-side re-scoring', () => {
  it('scores the five windows with the shared engine and rejects anything off the published puzzle', async () => {
    const { rounds, total, slate } = await roundsFor(DAY, 3);
    expect(verifyRounds(slate, rounds)).toBe(total);
    expect(verifyRounds(slate, rounds.slice(0, 4))).toBeNull();
    expect(verifyRounds(slate, [...rounds].reverse())).toBeNull();
    expect(verifyRounds(slate, rounds.map((r, i) => (i === 0 ? { ...r, id: 'nba-made-up' } : r)))).toBeNull();
    expect(verifyRounds(slate, rounds.map((r, i) => (i === 0 ? { ...r, hi: r.lo } : r)))).toBeNull(); // zero width
    expect(verifyRounds(slate, rounds.map((r, i) => (i === 0 ? { ...r, lo: r.lo + 0.5 } : r)))).toBeNull(); // off grid
    expect(verifyRounds(slate, rounds.map((r, i) => (i === 0 ? { ...r, lo: -1e9 } : r)))).toBeNull(); // outside scale
    expect(verifyRounds(slate, rounds.map((r, i) => (i === 0 ? { ...r, lo: 'x' } : r)))).toBeNull();
  });
});

describe('POST /api/scores', () => {
  it('stores one first completion, and a refresh or second tab gets the first score back', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    const first = await submit(ctx, { v: 1, day: DAY, player: player(1), rounds: a.rounds, total: a.total });
    expect(first.code).toBe(200);
    expect(first.body).toMatchObject({ status: 'stored', score: a.total, n: 1, ready: false, percentile: null, season: 'beta', day: DAY });
    const b = await roundsFor(DAY, 1);
    const again = await submit(ctx, { v: 1, day: DAY, player: player(1), rounds: b.rounds, total: b.total });
    expect(again.body).toMatchObject({ status: 'duplicate', score: a.total, n: 1 });
  });

  it('races: ten simultaneous submissions from one browser count once', async () => {
    const { ctx } = testContext({ limits: { ...DEFAULT_LIMITS, subTtl: 604800, distTtl: 1e7, dailyBudget: 1000, ratePerMinute: 100 } });
    const a = await roundsFor(DAY, 2);
    const outs = await Promise.all(Array.from({ length: 10 }, () => submit(ctx, { day: DAY, player: player(2), rounds: a.rounds })));
    expect(outs.filter((o) => o.body.status === 'stored')).toHaveLength(1);
    expect(outs.every((o) => o.body.n === 1)).toBe(true);
  });

  it('rejects a claimed total that does not match the windows', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    const r = await submit(ctx, { day: DAY, player: player(3), rounds: a.rounds, total: 500 });
    expect(r).toMatchObject({ code: 422, body: { status: 'invalid' } });
  });

  it('never counts an archive day, a future day or a stale day', async () => {
    const { ctx, store } = testContext();
    for (const day of ['2026-11-16', '2026-11-19', '2026-11-17']) {
      const a = await roundsFor(day, 2);
      const r = await submit(ctx, { day, player: player(4), rounds: a.rounds });
      expect(r.body.status).toBe('ineligible');
    }
    expect([...store.dump().keys()].some((k) => k.includes(':sub:'))).toBe(false);
  });

  it('counts yesterday’s run finished just after midnight under yesterday', async () => {
    const { ctx } = testContext({}, { t: Date.parse('2026-11-19T00:20:00Z') });
    const a = await roundsFor(DAY, 2);
    const r = await submit(ctx, { day: DAY, player: player(5), rounds: a.rounds });
    expect(r.body).toMatchObject({ status: 'stored', day: DAY });
  });

  it('asks for consent in the EU/UK or when the country is unknown, and stores nothing', async () => {
    const { ctx, store } = testContext();
    const a = await roundsFor(DAY, 2);
    for (const c of ['DE', 'GB', '']) {
      const r = await submit(ctx, { day: DAY, player: player(6), rounds: a.rounds }, { 'x-vercel-ip-country': c });
      expect(r).toMatchObject({ code: 409, body: { status: 'consent-required' } });
    }
    expect(store.dump().size).toBe(0);
    const ok = await submit(ctx, { day: DAY, player: player(6), rounds: a.rounds, consent: 'granted' }, { 'x-vercel-ip-country': 'DE' });
    expect(ok.body.status).toBe('stored');
  });

  it('keeps QA submissions out of the real season', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    const qa = await submit(ctx, { day: DAY, player: player(7), rounds: a.rounds, test: true });
    expect(qa.body).toMatchObject({ status: 'stored', season: 'qa', n: 1 });
    const real = await submit(ctx, { day: DAY, player: player(8), rounds: a.rounds });
    expect(real.body).toMatchObject({ season: 'beta', n: 1 });
  });

  it('partitions a formal launch season from beta', async () => {
    const { ctx } = testContext({ launchDay: DAY });
    const a = await roundsFor(DAY, 2);
    expect((await submit(ctx, { day: DAY, player: player(9), rounds: a.rounds })).body.season).toBe('s1');
  });

  it('validates shape, size, origin and method', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    expect((await submit(ctx, { day: DAY, player: 'short', rounds: a.rounds })).code).toBe(422);
    expect((await handle(post('{"day":', {}), ctx)).status).toBe(422);
    expect((await handle(post('x'.repeat(5000)), ctx)).status).toBe(422);
    expect((await handle(post({ day: DAY }, { 'content-type': 'text/plain' }), ctx)).status).toBe(422);
    expect((await handle(post({ day: DAY, player: player(1), rounds: a.rounds }, { origin: 'https://evil.example' }), ctx)).status).toBe(403);
    expect((await handle(post({}, { 'sec-fetch-site': 'cross-site' }), ctx)).status).toBe(403);
    expect((await handle(new Request('https://stat-window.vercel.app/api/scores', { method: 'PUT' }), ctx)).status).toBe(405);
  });

  it('rate-limits one client before it can spend the budget, then pauses everything at the daily budget', async () => {
    const { ctx } = testContext({ limits: { ...DEFAULT_LIMITS, dailyBudget: COST.submit * 7, ratePerMinute: 3 } });
    const a = await roundsFor(DAY, 2);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await submit(ctx, { day: DAY, player: player(100 + i), rounds: a.rounds })).code);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    // The two limited calls cost nothing, so four more fit before the pause.
    for (let i = 0; i < 5; i++) codes.push((await submit(ctx, { day: DAY, player: player(200 + i), rounds: a.rounds }, { 'x-real-ip': `198.51.100.${i}` })).code);
    expect(codes.slice(5)).toEqual([200, 200, 200, 200, 503]);
  });

  it('once paused, an instance stops calling the store until the next UTC day', async () => {
    const { ctx, nowRef } = testContext({ limits: { ...DEFAULT_LIMITS, dailyBudget: COST.submit } });
    const a = await roundsFor(DAY, 2);
    expect((await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds })).code).toBe(200);
    expect((await submit(ctx, { day: DAY, player: player(2), rounds: a.rounds })).code).toBe(503);
    let calls = 0;
    const real = ctx.store!;
    ctx.store = { submit: (...x) => (calls++, real.submit(...x)), read: (...x) => (calls++, real.read(...x)), removeMany: (...x) => (calls++, real.removeMany(...x)) };
    expect((await submit(ctx, { day: DAY, player: player(3), rounds: a.rounds })).code).toBe(503);
    expect((await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx)).status).toBe(503);
    expect(calls).toBe(0);
    // Deletion is never paused by the daily budget.
    expect((await handle(post({ player: player(1), days: [DAY] }, {}, 'DELETE'), ctx)).status).toBe(200);
    expect(calls).toBe(1);
    nowRef.t += 86_400_000;
    const tomorrow = await roundsFor('2026-11-19', 2);
    expect((await submit(ctx, { day: '2026-11-19', player: player(4), rounds: tomorrow.rounds })).code).toBe(200);
  });

  it('pauses for the rest of the month at the monthly ceiling, which an env var can only lower', async () => {
    const { ctx } = testContext({ limits: { ...DEFAULT_LIMITS, monthlyBudget: COST.submit } });
    const a = await roundsFor(DAY, 2);
    expect((await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds })).code).toBe(200);
    expect((await submit(ctx, { day: DAY, player: player(2), rounds: a.rounds })).code).toBe(503);
    expect(ctx.memo.pausedUntil).toBe(Date.UTC(2026, 11, 1));
    const env = { SCORES_ENABLED: '1', SCORE_HASH_SECRET: 'x', SCORES_MONTHLY_BUDGET: '9999999' };
    expect(contextFromEnv(env, { store: null, loadSlate: fileSlates() }).limits.monthlyBudget).toBe(DEFAULT_LIMITS.monthlyBudget);
  });

  it('caps scores stored from one network per day, and treats an IPv6 /64 as one network', async () => {
    const { ctx, nowRef } = testContext({ limits: { ...DEFAULT_LIMITS, ipDailyStored: 2 } });
    const a = await roundsFor(DAY, 2);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await submit(ctx, { day: DAY, player: player(400 + i), rounds: a.rounds }, { 'x-real-ip': `2001:db8:1:2::${i + 1}` })).code);
      nowRef.t += 61_000;
    }
    expect(codes).toEqual([200, 200, 429]);
    expect(ipPrefix('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipPrefix('2001:0db8:0001:0002:0:0:0:9')).toBe('2001:db8:1:2::/64');
    expect(ipPrefix('::1')).toBe('0:0:0:0::/64');
    expect(ipPrefix('203.0.113.7')).toBe('203.0.113.7');
  });

  it('is off until SCORES_ENABLED=1 and a store are configured, but deletion keeps working', async () => {
    const { ctx } = testContext({ enabled: false });
    expect((await handle(post({}), ctx)).status).toBe(503);
    expect((await handle(post({ player: player(1), days: [DAY] }, {}, 'DELETE'), ctx)).status).toBe(200);
    const { ctx: noStore } = testContext({ store: null });
    expect((await handle(post({}), noStore)).status).toBe(503);
  });

  it('fails closed on Vercel without a known environment or a long hash secret', () => {
    const deps = { store: memoryStore() as ScoreStore, loadSlate: fileSlates() };
    const long = 'k'.repeat(40);
    expect(contextFromEnv({ VERCEL: '1', SCORES_ENABLED: '1', SCORE_HASH_SECRET: long }, deps)).toMatchObject({ enabled: false, secret: '' });
    expect(contextFromEnv({ VERCEL: '1', VERCEL_ENV: 'production', SCORES_ENABLED: '1', SCORE_HASH_SECRET: 'short' }, deps).secret).toBe('');
    expect(contextFromEnv({ VERCEL: '1', VERCEL_ENV: 'production', SCORES_ENABLED: '1', UPSTASH_REDIS_REST_TOKEN: long }, deps).secret).toBe('');
    const prod = contextFromEnv({ VERCEL: '1', VERCEL_ENV: 'production', SCORES_ENABLED: '1', SCORE_HASH_SECRET: long, PERCENTILE_MIN_SAMPLE: '3' }, deps);
    expect(prod).toMatchObject({ enabled: true, env: 'production', minSample: 100 });
    expect(contextFromEnv({ VERCEL: '1', SCORES_NAMESPACE: 'staging', SCORES_ENABLED: '1', SCORE_HASH_SECRET: long }, deps)).toMatchObject({ enabled: true, env: 'staging' });
  });

  it('fails soft when the store throws', async () => {
    const { ctx } = testContext({ store: { submit: () => Promise.reject(new Error('down')), read: () => Promise.reject(new Error('down')), removeMany: () => Promise.reject(new Error('down')) } });
    const a = await roundsFor(DAY, 2);
    expect(await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds })).toMatchObject({ code: 503, body: { status: 'unavailable' } });
  });
});

describe('percentiles past the sample gate', () => {
  it('stays gated below the threshold and reports midrank once it is crossed', async () => {
    const { ctx } = testContext({ minSample: 4, limits: { ...DEFAULT_LIMITS, subTtl: 604800, distTtl: 1e7, dailyBudget: 1000, ratePerMinute: 100 } });
    const widths = [30, 20, 10, 10];
    const outs = [];
    for (const [i, w] of widths.entries()) {
      const a = await roundsFor(DAY, w);
      outs.push((await submit(ctx, { day: DAY, player: player(300 + i), rounds: a.rounds })).body);
    }
    expect(outs[2]).toMatchObject({ n: 3, ready: false, percentile: null });
    // Scores rise as windows narrow: two players tie at the top.
    expect(outs[3]).toMatchObject({ n: 4, ready: true, percentile: { rounded: 75, exact: 75 } });
    const get = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
    const body = (await get.json()) as { n: number; counts: Record<string, number> };
    expect(get.headers.get('cache-control')).toContain('s-maxage');
    expect(body.n).toBe(4);
    expect(Object.values(body.counts).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('GET reveals only n below the threshold, never buckets, and no player keys', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds });
    const res = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ n: 1, ready: false });
    expect(text).not.toContain('counts');
    expect(text).not.toContain(player(1));
    expect((await handle(new Request('https://stat-window.vercel.app/api/scores?day=2026-11-20'), ctx)).status).toBe(422);
    // Junk parameters would bypass the edge cache, so they are refused.
    expect((await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}&x=1`), ctx)).status).toBe(422);
  });
});

describe('DELETE /api/scores', () => {
  it('removes this browser’s record and its count, and only that', async () => {
    const { ctx } = testContext();
    const a = await roundsFor(DAY, 2);
    await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds });
    await submit(ctx, { day: DAY, player: player(2), rounds: a.rounds });
    const del = await handle(post({ player: player(1), days: [DAY] }, {}, 'DELETE'), ctx);
    expect(await del.json()).toMatchObject({ status: 'ok', removed: 1 });
    const again = await handle(post({ player: player(1), days: [DAY] }, {}, 'DELETE'), ctx);
    expect(await again.json()).toMatchObject({ removed: 0 });
    const re = await submit(ctx, { day: DAY, player: player(3), rounds: a.rounds });
    expect(re.body.n).toBe(2);
  });

  it('only looks at days whose records can still exist, in one store call', async () => {
    const { ctx } = testContext();
    let pairs = 0;
    const real = ctx.store!;
    ctx.store = { ...real, removeMany: (p, ...rest) => ((pairs = p.length), real.removeMany(p, ...rest)) };
    const days = Array.from({ length: 60 }, (_, i) => new Date(NOON.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    expect((await handle(post({ player: player(1), days }, {}, 'DELETE'), ctx)).status).toBe(200);
    expect(pairs).toBe(9 * 2);
  });
});
