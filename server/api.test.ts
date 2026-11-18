import { describe, expect, it } from 'vitest';
import { eligibleDay, handle, verifyRounds } from './api.ts';
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
    const { ctx } = testContext({ limits: { subTtl: 604800, distTtl: 1e7, dailyBudget: 1000, ratePerMinute: 100 } });
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

  it('rate-limits one client and pauses everything at the daily budget', async () => {
    const { ctx } = testContext({ limits: { subTtl: 604800, distTtl: 1e7, dailyBudget: 9, ratePerMinute: 3 } });
    const a = await roundsFor(DAY, 2);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await submit(ctx, { day: DAY, player: player(100 + i), rounds: a.rounds })).code);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    for (let i = 0; i < 5; i++) codes.push((await submit(ctx, { day: DAY, player: player(200 + i), rounds: a.rounds }, { 'x-real-ip': `198.51.100.${i}` })).code);
    expect(codes.slice(5)).toEqual([200, 200, 200, 200, 503]);
  });

  it('is off until SCORES_ENABLED=1 and a store are configured', async () => {
    const { ctx } = testContext({ enabled: false });
    expect((await handle(post({}), ctx)).status).toBe(503);
    const { ctx: noStore } = testContext({ store: null });
    expect((await handle(post({}), noStore)).status).toBe(503);
  });

  it('fails soft when the store throws', async () => {
    const { ctx } = testContext({ store: { submit: () => Promise.reject(new Error('down')), read: () => Promise.reject(new Error('down')), remove: () => Promise.reject(new Error('down')) } });
    const a = await roundsFor(DAY, 2);
    expect(await submit(ctx, { day: DAY, player: player(1), rounds: a.rounds })).toMatchObject({ code: 503, body: { status: 'unavailable' } });
  });
});

describe('percentiles past the sample gate', () => {
  it('stays gated below the threshold and reports midrank once it is crossed', async () => {
    const { ctx } = testContext({ minSample: 4, limits: { subTtl: 604800, distTtl: 1e7, dailyBudget: 1000, ratePerMinute: 100 } });
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
});
