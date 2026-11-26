/**
 * Question comparison (docs/PERCENTILES.md "Question comparison"): behaviour of the real handler
 * with the in-memory store, which implements the same contract as the Lua scripts
 * (server/redis.test.ts runs the scripts themselves on a real redis-server).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, handle, verifyRun, type ApiContext, type ServerSlate } from './api.ts';
import { DAY, player, post, testContext, windowFor } from './fixtures.ts';
import { fileSlates } from './slates.ts';
import { COST, memoryStore, type Limits } from './store.ts';
import { scoreWindow, rangeSteps, fromSteps } from '../src/engine/scoring.ts';
import { questionCrowdLine, summarizeQuestion, emptyTally, toughestQuestion, type QuestionStat } from '../src/engine/percentile.ts';

type Spec = 't' | 'm' | 'z' | number;
const roomy: Limits = { ...DEFAULT_LIMITS, ratePerMinute: 10_000, ipDailyStored: 10_000, ipDailyCalls: 10_000, dailyBudget: 1_000_000, readDailyBudget: 100_000, questionDailyCeiling: 900_000 };

let slateCache: ServerSlate | null = null;
async function slate() {
  slateCache ??= (await fileSlates()(DAY))!;
  return slateCache;
}

/** A window for one question: 't' the full scale (a timeout), 'm' a miss, 'z' a zero-point catch, or a hit `n` steps wide. */
function windowOf(q: ServerSlate['questions'][number], s: Spec) {
  if (s === 't') return { id: q.id, lo: q.min, hi: q.max };
  if (s === 'm') return windowFor(q, 2, false);
  if (s === 'z') {
    const range = rangeSteps(q);
    const a = Math.round((q.answer - q.min) / q.step);
    const lo = a >= 1 ? 1 : 0;
    const w = { id: q.id, lo: fromSteps(q, lo), hi: fromSteps(q, lo + range - 1) };
    if (scoreWindow(q, w).points !== 0 || !scoreWindow(q, w).hit) throw new Error(`no zero-point catch on ${q.id}`);
    return w;
  }
  return windowFor(q, s, true);
}

async function run(specs: Spec[]) {
  const sl = await slate();
  const rounds = sl.questions.map((q, i) => windowOf(q, specs[i]!));
  return { rounds, total: verifyRun(sl, rounds)!.total };
}

const send = async (ctx: ApiContext, n: number, specs: Spec[], extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const { rounds } = await run(specs);
  const res = await handle(post({ day: DAY, player: player(n), rounds, ...extra }, { 'x-real-ip': `198.51.${Math.floor(n / 250) % 250}.${n % 250}`, ...headers }), ctx);
  return { code: res.status, body: (await res.json()) as Record<string, unknown> };
};

const read = async (ctx: ApiContext) => {
  const res = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
  return { code: res.status, body: (await res.json()) as { n: number; questions: QuestionStat[] | null; status: string } };
};

const qKey = (env = 'development', season = 'beta') => `sw:v1:${env}:${season}:${DAY}:q`;
const qHash = (store: ReturnType<typeof memoryStore>, env?: string, season?: string) =>
  (store.dump().get(qKey(env, season)) as Map<string, number> | undefined) ?? new Map<string, number>();

describe('outcomes from the verified windows only', () => {
  it('tells a timeout, a miss, a zero-point catch and a scoring catch apart without trusting the client', async () => {
    const sl = await slate();
    const { rounds } = await run(['z', 'm', 't', 3, 't']);
    const v = verifyRun(sl, rounds)!;
    expect(v.outcomes.slice(0, 3)).toEqual(['z', 'm', 't']);
    expect(typeof v.outcomes[3]).toBe('number');
    expect(v.outcomes[3]).toBeGreaterThan(0);
    // Zero points never means a miss: the 'z' and 't' rounds also score 0.
    expect(v.total).toBe(v.outcomes[3]);
  });
});

describe('the question tally rides on the existing submission', () => {
  it('adds the five outcomes in the same store call as the total, and keeps no windows', async () => {
    const { ctx, store } = testContext({ limits: roomy });
    const r = await send(ctx, 1, ['z', 'm', 't', 3, 4]);
    expect(r.body.status).toBe('stored');
    const h = qHash(store);
    const sl = await slate();
    expect(h.get(`${sl.questions[0]!.id}:z`)).toBe(1);
    expect(h.get(`${sl.questions[1]!.id}:m`)).toBe(1);
    expect(h.get(`${sl.questions[2]!.id}:t`)).toBe(1);
    expect([...h.values()].reduce((a, b) => a + b, 0)).toBe(5);
    // The linked record holds the total and the five fields it added: no lo/hi values.
    const sub = [...store.dump()].find(([k]) => k.includes(':sub:'))![1] as string;
    expect(sub.split(' ')).toHaveLength(6);
    expect(sub).not.toMatch(/\d+\.\d/);
    expect(COST.submit).toBe(27);
  });

  it('first completion wins: a duplicate, a retry with other windows, or 20 racing tabs count once', async () => {
    const { ctx, store } = testContext({ limits: roomy });
    const outs = await Promise.all(Array.from({ length: 20 }, (_, i) => send(ctx, 7, i % 2 ? [2, 2, 2, 2, 2] : [5, 5, 5, 5, 5])));
    expect(outs.filter((o) => o.body.status === 'stored')).toHaveLength(1);
    expect([...qHash(store).values()].reduce((a, b) => a + b, 0)).toBe(5);
    const later = await send(ctx, 7, ['t', 't', 't', 't', 't']);
    expect(later.body.status).toBe('duplicate');
    expect([...qHash(store).values()].reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('mixed client versions contribute alike: no total, a v:1 body with total, and an old body all verify the same way', async () => {
    const { ctx, store } = testContext({ limits: roomy });
    const a = await run([2, 2, 2, 2, 2]);
    await send(ctx, 1, [2, 2, 2, 2, 2]);
    await send(ctx, 2, [2, 2, 2, 2, 2], { v: 1, total: a.total });
    await send(ctx, 3, [2, 2, 2, 2, 2], { total: a.total, consent: 'default' });
    expect((await send(ctx, 4, [2, 2, 2, 2, 2], { total: a.total + 1 })).code).toBe(422);
    const sl = await slate();
    expect([...qHash(store)].filter(([k]) => k.startsWith(`${sl.questions[0]!.id}:`)).reduce((s, [, v]) => s + v, 0)).toBe(3);
  });

  it('stores nothing for the questions when consent is needed, the network is limited or the key was revoked', async () => {
    const { ctx, store } = testContext({ limits: { ...roomy, ratePerMinute: 1 } });
    expect((await send(ctx, 1, [2, 2, 2, 2, 2], {}, { 'x-vercel-ip-country': 'FR' })).code).toBe(409);
    expect((await send(ctx, 1, [2, 2, 2, 2, 2], {}, { 'x-vercel-ip-country': '' })).code).toBe(409);
    expect(qHash(store).size).toBe(0);
    // Same network twice in a minute: the second is limited before it touches anything.
    expect((await send(ctx, 2, [2, 2, 2, 2, 2], {}, { 'x-real-ip': '192.0.2.1' })).code).toBe(200);
    expect((await send(ctx, 3, [2, 2, 2, 2, 2], {}, { 'x-real-ip': '192.0.2.1' })).code).toBe(429);
    expect([...qHash(store).values()].reduce((a, b) => a + b, 0)).toBe(5);
    await handle(post({ player: player(9), days: [] }, { 'x-real-ip': '192.0.2.9' }, 'DELETE'), ctx);
    expect((await send(ctx, 9, [2, 2, 2, 2, 2])).body.status).toBe('revoked');
    expect([...qHash(store).values()].reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe('reads: one cached GET, gated per question at 100', () => {
  it('returns only n per question below 100 eligible games, then midrank tables and shares at 100', async () => {
    const { ctx } = testContext({ limits: roomy });
    expect(ctx.minSample).toBe(100);
    for (let i = 0; i < 99; i++) await send(ctx, 1000 + i, [i % 3 === 0 ? 'm' : 2 + (i % 5), 3, i % 4 === 0 ? 't' : 4, 5, 6]);
    const below = await read(ctx);
    expect(below.code).toBe(200);
    expect(below.body.questions).toHaveLength(5);
    for (const q of below.body.questions!) expect(q).toEqual({ id: expect.any(String), n: 99, ready: false });
    expect(JSON.stringify(below.body)).not.toContain('pct');
    await send(ctx, 2000, [2, 3, 4, 5, 6]);
    const at = await read(ctx);
    const q0 = at.body.questions![0]!;
    expect(q0).toMatchObject({ n: 100, ready: true, scored: 67, missed: 33 });
    expect(q0.pct).toHaveLength(101);
    const sl = await slate();
    expect(at.body.questions!.map((q) => q.id)).toEqual(sl.questions.map((q) => q.id));
  });

  it('counts only games stored with question data: historical total-only records are not question contributions', async () => {
    const { ctx, store } = testContext({ minSample: 3, limits: roomy });
    // An older deployment stored totals only (no fields), for the same day and season.
    const budget = { day: 'sw:v1:budget:d:x', month: 'sw:v1:budget:m:x', erase: 'sw:v1:budget:e:x', reads: 'sw:v1:budget:r:x' };
    const p = `sw:v1:development:beta:${DAY}`;
    for (let i = 0; i < 5; i++) {
      await store.submit({ sub: `${p}:sub:old${i}`, dist: `${p}:dist`, q: `${p}:q`, rate: `r${i}`, ipDay: `d${i}`, ipCalls: `c${i}`, revocation: `rev${i}`, budget }, 100, roomy);
    }
    for (let i = 0; i < 2; i++) await send(ctx, 10 + i, [2, 2, 2, 2, 2]);
    const r = await read(ctx);
    expect(r.body.n).toBe(7);
    expect(r.body.questions![0]).toMatchObject({ n: 2, ready: false });
    await send(ctx, 12, [2, 2, 2, 2, 2]);
    expect((await read(ctx)).body.questions![0]).toMatchObject({ n: 3, ready: true });
  });

  it('is part of the same edge-cached response, and missing or unknown slates give no question data', async () => {
    const { ctx } = testContext({ limits: roomy });
    let reads = 0;
    const real = ctx.store!;
    ctx.store = { ...real, read: (...a) => (reads++, real.read(...a)) };
    const r = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
    expect(r.headers.get('cache-control')).toContain('s-maxage=300');
    expect(reads).toBe(1);
    const { ctx: noSlate } = testContext({ limits: roomy, loadSlate: async () => null });
    expect((await read(noSlate)).body.questions).toBeNull();
    const { ctx: broken } = testContext({ limits: roomy, loadSlate: () => Promise.reject(new Error('fs')) });
    expect((await read(broken)).body).toMatchObject({ status: 'ok', questions: null });
  });

  it('keeps environments and seasons apart', async () => {
    const store = memoryStore(() => Date.parse(`${DAY}T12:00:00Z`));
    const { ctx: prod } = testContext({ store, env: 'production', minSample: 1, limits: roomy });
    const { ctx: preview } = testContext({ store, env: 'preview', minSample: 1, limits: roomy });
    await send(prod, 1, [2, 2, 2, 2, 2]);
    await send(prod, 2, [2, 2, 2, 2, 2], { test: true });
    expect((await read(prod)).body.questions![0]).toMatchObject({ n: 1 });
    expect((await read(preview)).body.questions![0]).toMatchObject({ n: 0, ready: false });
    expect(qHash(store, 'production', 'qa').size).toBe(5);
    const { ctx: launch } = testContext({ store, env: 'production', minSample: 1, limits: roomy, launchDay: DAY });
    expect((await read(launch)).body.questions![0]).toMatchObject({ n: 0 });
  });
});

describe('statistics: midrank, ties and small cells', () => {
  const tally = (points: number[], extra: Partial<{ zero: number; miss: number; timeout: number }> = {}) => {
    const t = emptyTally();
    for (const p of points) t.scoring[p]! += 1;
    return { ...t, zero: extra.zero ?? 0, miss: extra.miss ?? 0, timeout: extra.timeout ?? 0 };
  };

  it('gives ties half credit and puts every zero-point outcome at 0', () => {
    // 100 games: 20 misses, 10 timeouts, 10 too-wide catches (all 0 points), 30 at 50, 30 at 80.
    const s = summarizeQuestion('q', tally([...Array(30).fill(50), ...Array(30).fill(80)], { miss: 20, timeout: 10, zero: 10 }), 100);
    expect(s.pct![0]).toBe(20); // 0.5 × 40 / 100
    expect(s.pct![50]).toBe(55); // (40 + 15) / 100
    expect(s.pct![60]).toBe(70); // nobody at 60: everyone at or below 50 is below
    expect(s.pct![80]).toBe(85);
    expect(s.pct![100]).toBe(100);
    expect(s.scored).toBe(60);
    expect(s.missed).toBe(20); // timeouts are not misses
    const all = summarizeQuestion('q', tally(Array(100).fill(37)), 100);
    expect(all.pct![37]).toBe(50);
  });

  it('suppresses a share when a cell or its complement holds fewer than 5 games', () => {
    const few = summarizeQuestion('q', tally(Array(4).fill(10), { miss: 96 }), 100);
    expect(few.scored).toBeUndefined();
    expect(few.missed).toBeUndefined();
    expect(few.pct).toBeUndefined(); // the table would reveal the 4 scoring games too
    const enough = summarizeQuestion('q', tally(Array(5).fill(10), { miss: 95 }), 100);
    expect(enough.pct).toHaveLength(101);
    expect(enough.pct!.every((v) => v % 5 === 0)).toBe(true);
    const almostAll = summarizeQuestion('q', tally(Array(97).fill(10), { miss: 3 }), 100);
    expect(almostAll.scored).toBeUndefined();
  });

  it('says "percentile for this question" for a scoring catch, a crowd share otherwise, and nothing below the gate', () => {
    const s = summarizeQuestion('q', tally([...Array(30).fill(50), ...Array(30).fill(80)], { miss: 20, timeout: 10, zero: 10 }), 100);
    expect(questionCrowdLine(s, 80)).toBe('85th percentile for this question, among 100 eligible completed games.');
    expect(questionCrowdLine(s, 0)).toBe('60% of 100 eligible completed games scored on this question.');
    for (const line of [questionCrowdLine(s, 80), questionCrowdLine(s, 0)]) expect(line).not.toMatch(/beat|better than|missed/i);
    expect(questionCrowdLine({ ...s, n: 99 }, 80)).toBeNull();
    expect(questionCrowdLine(summarizeQuestion('q', tally([50]), 100), 50)).toBeNull();
    expect(questionCrowdLine(s, 101)).toBeNull();
    expect(questionCrowdLine({ ...s, scored: undefined } as QuestionStat, 0)).toBeNull();
  });

  it('names the toughest question only when all five are publishable and one is clearly lowest', () => {
    const mk = (scored: number) => summarizeQuestion('q', tally(Array(scored).fill(20), { miss: 100 - scored }), 100);
    expect(toughestQuestion([mk(60), mk(30), mk(50), mk(70), mk(80)])).toEqual({ index: 1, scored: 30, n: 100 });
    expect(toughestQuestion([mk(30), mk(30), mk(50), mk(70), mk(80)])).toBeNull();
    expect(toughestQuestion([mk(60), null, mk(50), mk(70), mk(80)])).toBeNull();
  });
});

describe('capacity: the question comparison pauses first, safely', () => {
  it('past the question ceiling a first completion is stored total-only, and that day stops showing questions', async () => {
    const { ctx, store } = testContext({ minSample: 1, limits: { ...roomy, questionDailyCeiling: COST.submit * 2 } });
    await send(ctx, 1, [2, 2, 2, 2, 2]);
    await send(ctx, 2, [2, 2, 2, 2, 2]);
    const third = await send(ctx, 3, [2, 2, 2, 2, 2]);
    expect(third.body).toMatchObject({ status: 'stored', n: 3 });
    expect(store.dump().get(`sw:v1:budget:d:${DAY}`)).toBe(COST.submit * 2 + COST.submitTotalOnly);
    const r = await read(ctx);
    expect(r.body).toMatchObject({ status: 'ok', n: 3, questions: null });
    // The total-only record is still erasable and leaves the tally consistent.
    const del = await handle(post({ player: player(3), days: [DAY] }, { 'x-real-ip': '192.0.2.50' }, 'DELETE'), ctx);
    expect(await del.json()).toMatchObject({ removed: 1 });
    expect([...qHash(store)].filter(([k]) => k !== '!').reduce((s, [, v]) => s + v, 0)).toBe(10);
  });

  it('reads have their own daily ceiling: GET pauses, submissions and deletion carry on', async () => {
    const { ctx } = testContext({ minSample: 1, limits: { ...roomy, readDailyBudget: COST.read * 2 } });
    expect((await read(ctx)).code).toBe(200);
    expect((await read(ctx)).code).toBe(200);
    expect((await read(ctx)).code).toBe(503);
    expect(ctx.memo.readsPausedUntil).toBeGreaterThan(0);
    expect(ctx.memo.pausedUntil).toBe(0);
    expect((await send(ctx, 1, [2, 2, 2, 2, 2])).body.status).toBe('stored');
    expect((await handle(post({ player: player(1), days: [] }, {}, 'DELETE'), ctx)).status).toBe(200);
  });

  it('at the daily budget everything optional pauses (503), and a paused call charges nothing', async () => {
    const { ctx, store } = testContext({ minSample: 1, limits: { ...roomy, dailyBudget: COST.submit + COST.read } });
    await send(ctx, 1, [2, 2, 2, 2, 2]);
    expect((await read(ctx)).code).toBe(200);
    expect((await send(ctx, 2, [2, 2, 2, 2, 2])).code).toBe(503);
    expect((await read(ctx)).code).toBe(503);
    expect(store.dump().get(`sw:v1:budget:d:${DAY}`)).toBe(COST.submit + COST.read);
  });

  it('a lowered budget lowers the sub-ceilings with it', async () => {
    const { contextFromEnv } = await import('./api.ts');
    const c = contextFromEnv({ SCORES_ENABLED: '1', SCORE_HASH_SECRET: 'x', SCORES_DAILY_BUDGET: '7000', SCORES_MONTHLY_BUDGET: '190000' }, { store: null, loadSlate: fileSlates() });
    expect(c.limits).toMatchObject({ readDailyBudget: 2000, questionDailyCeiling: 6000, questionMonthlyCeiling: 170_000 });
    expect(c.limits.questionDailyCeiling).toBeLessThan(c.limits.dailyBudget);
  });
});

describe('deletion and revocation take back the question contributions', () => {
  it('removes exactly this browser’s five outcomes, charges for them, and leaves everyone else’s', async () => {
    const { ctx, store } = testContext({ minSample: 1, limits: roomy });
    await send(ctx, 1, ['m', 3, 't', 4, 'm']);
    await send(ctx, 2, [2, 3, 4, 5, 6]);
    const before = new Map(qHash(store));
    const del = await handle(post({ player: player(1), days: [DAY] }, { 'x-real-ip': '192.0.2.77' }, 'DELETE'), ctx);
    expect(await del.json()).toMatchObject({ status: 'ok', removed: 1 });
    const after = qHash(store);
    expect([...after.values()].reduce((a, b) => a + b, 0)).toBe(5);
    expect([...before.values()].reduce((a, b) => a + b, 0)).toBe(10);
    const sl = await slate();
    expect(after.has(`${sl.questions[0]!.id}:m`)).toBe(false);
    expect(store.dump().get(`sw:v1:budget:e:${DAY.slice(0, 7)}`)).toBe(COST.removeSpent(27, 1, 5));
    expect(COST.remove(27)).toBeGreaterThanOrEqual(COST.removeSpent(27, 27, 135));
    expect((await read(ctx)).body.questions![0]).toMatchObject({ n: 1 });
  });

  it('an old total-only record is deleted without touching the question tally', async () => {
    const { ctx, store } = testContext({ minSample: 1, limits: roomy });
    await send(ctx, 2, [2, 3, 4, 5, 6]);
    // A record written by the previous version: just the total under the browser's hashed key.
    const sub = [...store.dump().keys()].find((k) => k.includes(':sub:'))!;
    const total = Number(String(store.dump().get(sub)).split(' ')[0]);
    const { ctx: old } = testContext({ store, minSample: 1, limits: roomy });
    // Re-create player 3's record in the old format through the store contract (no fields).
    const p = `sw:v1:development:beta:${DAY}`;
    const { createHmac } = await import('node:crypto');
    const h = createHmac('sha256', 'test-secret').update(`beta:${DAY}:${player(3)}`).digest('hex').slice(0, 32);
    await store.submit({ sub: `${p}:sub:${h}`, dist: `${p}:dist`, q: `${p}:q`, rate: 'r', ipDay: 'd', ipCalls: 'c', revocation: 'none', budget: { day: 'x', month: 'y', erase: 'z', reads: 'w' } }, total, roomy);
    const del = await handle(post({ player: player(3), days: [DAY] }, { 'x-real-ip': '192.0.2.78' }, 'DELETE'), old);
    expect(await del.json()).toMatchObject({ removed: 1 });
    expect([...qHash(store).values()].reduce((a, b) => a + b, 0)).toBe(5);
    expect((await read(old)).body).toMatchObject({ n: 1 });
  });

  it('a submission in flight when the browser deletes is refused, and leaves no question contribution', async () => {
    const base = testContext({ minSample: 1, limits: roomy });
    const real = base.ctx.store!;
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const begun = new Promise<void>((r) => (started = r));
    base.ctx.store = { ...real, submit: async (...a) => (started(), await held, real.submit(...a)) };
    const late = send(base.ctx, 5, [2, 2, 2, 2, 2]);
    await begun;
    expect((await handle(post({ player: player(5), days: [DAY] }, { 'x-real-ip': '192.0.2.80' }, 'DELETE'), base.ctx)).status).toBe(200);
    release();
    expect((await late).body.status).toBe('revoked');
    expect(qHash(base.store).size).toBe(0);
  });
});
