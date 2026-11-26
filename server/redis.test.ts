/**
 * Runs the production Lua scripts on a real redis-server (REDIS_URL, e.g. redis://127.0.0.1:6379).
 * CI starts one as a service; locally: `redis-server --port 6390 --daemonize yes` then
 * `REDIS_URL=redis://127.0.0.1:6390 npx vitest run server`. Each test uses its own key namespace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, handle } from './api.ts';
import { DAY, player, post, roundsFor, testContext } from './fixtures.ts';
import { respClient } from './resp.ts';
import { COST, READ_LUA, REMOVE_LUA, SUBMIT_LUA, redisStore, type Eval } from './store.ts';
import { verifyRun } from './api.ts';
import { fileSlates } from './slates.ts';

const url = process.env.REDIS_URL;
const run = `t${Date.now().toString(36)}`;

describe.skipIf(!url)('Lua scripts on a real redis-server', () => {
  let client: ReturnType<typeof respClient>;
  beforeAll(() => {
    client = respClient(url!);
  });
  afterAll(() => client?.close());

  const limits = { ...DEFAULT_LIMITS, subTtl: 604800, distTtl: 34560000, dailyBudget: 10_000, ratePerMinute: 1000 };

  it('stores atomically, dedupes concurrent submissions, sets TTLs and deletes cleanly', async () => {
    const env = `${run}a`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits, minSample: 3, env, budgetPrefix: `sw:v1:${env}:budget` });
    const a = await roundsFor(DAY, 2);
    const send = (p: string) => handle(post({ day: DAY, player: p, rounds: a.rounds }), ctx).then((r) => r.json() as Promise<Record<string, unknown>>);
    const race = await Promise.all(Array.from({ length: 20 }, () => send(player(1))));
    expect(race.filter((r) => r.status === 'stored')).toHaveLength(1);
    expect(race.filter((r) => r.status === 'duplicate')).toHaveLength(19);
    await send(player(2));
    const third = await send(player(3));
    expect(third).toMatchObject({ n: 3, ready: true, percentile: { rounded: 50 } });

    const keys = (await client.command(['KEYS', `sw:v1:${env}:*`])) as string[];
    const subs = keys.filter((k) => k.includes(':sub:'));
    expect(subs).toHaveLength(3);
    // No raw browser key anywhere in the store.
    expect(keys.some((k) => k.includes(player(1)))).toBe(false);
    const ttl = (await client.command(['TTL', subs[0]!])) as number;
    expect(ttl).toBeGreaterThan(604000);
    expect(ttl).toBeLessThanOrEqual(604800);

    const del = await handle(post({ player: player(1), days: [DAY] }, {}, 'DELETE'), ctx);
    expect(await del.json()).toMatchObject({ removed: 1 });
    const get = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
    expect(await get.json()).toMatchObject({ n: 2, ready: false });
  });

  it('pauses at the budget inside the script', async () => {
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits: { ...limits, dailyBudget: COST.submit * 2 }, env: `${run}b`, budgetPrefix: `sw:v1:${run}b:budget` });
    const a = await roundsFor(DAY, 2);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await handle(post({ day: DAY, player: player(10 + i), rounds: a.rounds }), ctx)).status);
    expect(codes).toEqual([200, 200, 503]);
  });

  it('caps stored scores per network per day and counts the monthly ceiling', async () => {
    const env = `${run}c`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits: { ...limits, ipDailyStored: 1 }, env, budgetPrefix: `sw:v1:${env}:budget` });
    const a = await roundsFor(DAY, 2);
    const codes = [];
    for (let i = 0; i < 2; i++) codes.push((await handle(post({ day: DAY, player: player(20 + i), rounds: a.rounds }), ctx)).status);
    expect(codes).toEqual([200, 429]);
    const month = Number(await client.command(['GET', `sw:v1:${env}:budget:m:${DAY.slice(0, 7)}`]));
    expect(month).toBe(COST.submit * 2);
  });

  it('charges a resend less than a first submission, and stops a network after its daily calls (CR-2)', async () => {
    const env = `${run}e`;
    const prefix = `sw:v1:${env}:budget`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits: { ...limits, ipDailyCalls: 3 }, env, budgetPrefix: prefix });
    const a = await roundsFor(DAY, 2);
    const send = () => handle(post({ day: DAY, player: player(40), rounds: a.rounds }), ctx);
    const out = [];
    for (let i = 0; i < 4; i++) out.push(((await (await send()).json()) as { status: string }).status);
    expect(out).toEqual(['stored', 'duplicate', 'duplicate', 'limited']);
    expect(Number(await client.command(['GET', `${prefix}:d:${DAY}`]))).toBe(COST.submit + 2 * COST.duplicate);
  });

  it('deletion spends only its own counter, charges what it touched, and stops after the per-network daily cap (CR-1)', async () => {
    const env = `${run}d`;
    const prefix = `sw:v1:${env}:budget`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits: { ...limits, ipDailyDeletes: 2 }, env, budgetPrefix: prefix });
    const a = await roundsFor(DAY, 2);
    await handle(post({ day: DAY, player: player(30), rounds: a.rounds }, { 'x-real-ip': '198.51.100.30' }), ctx);
    const shared = Number(await client.command(['GET', `${prefix}:m:${DAY.slice(0, 7)}`]));
    const del = (p: string) => handle(post({ player: p, days: [DAY] }, {}, 'DELETE'), ctx);
    expect(await (await del(player(31))).json()).toMatchObject({ removed: 0 });
    expect((await del(player(31))).status).toBe(200);
    expect((await del(player(31))).status).toBe(429);
    expect(Number(await client.command(['GET', `${prefix}:m:${DAY.slice(0, 7)}`]))).toBe(shared);
    expect(Number(await client.command(['GET', `${prefix}:e:${DAY.slice(0, 7)}`]))).toBe(2 * COST.removeSpent(27, 0));
    // Another network's real player still deletes their stored score.
    expect(await (await handle(post({ player: player(30), days: [DAY] }, { 'x-real-ip': '198.51.100.30' }, 'DELETE'), ctx)).json()).toMatchObject({ removed: 1 });
    expect(Number(await client.command(['GET', `${prefix}:e:${DAY.slice(0, 7)}`]))).toBe(2 * COST.removeSpent(27, 0) + COST.removeSpent(27, 1, 5));
  });
  it('rejects an old-code POST after DELETE using real Redis 7, even when the POST started before erasure', async () => {
    const env = `${run}revoked`;
    const store = redisStore(client.evaluate);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const awaiting = new Promise<void>((resolve) => { started = resolve; });
    const { ctx } = testContext({
      store: {
        ...store,
        submit: async (...args) => {
          started();
          await held; // Simulate an API handler stalled before atomic score submission.
          return store.submit(...args);
        },
      },
      limits,
      env,
      budgetPrefix: `sw:v1:${env}:budget`,
    });
    const code = player(96);
    const { rounds } = await roundsFor(DAY, 2);
    const delayed = handle(post({ day: DAY, player: code, rounds }), ctx);
    await awaiting;
    const deleted = await handle(post({ player: code, days: [DAY] }, {}, 'DELETE'), ctx);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ status: 'ok', removed: 0 });
    release();
    const response = await delayed;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 'revoked' });
    const dist = await store.read({ dist: `sw:v1:${env}:beta:${DAY}:dist`, q: `sw:v1:${env}:beta:${DAY}:q` },
      { day: `sw:v1:${env}:budget:d:${DAY}`, month: `sw:v1:${env}:budget:m:${DAY.slice(0,7)}`, erase: `sw:v1:${env}:budget:e:${DAY.slice(0,7)}`, reads: `sw:v1:${env}:budget:r:${DAY}` }, limits);
    expect('n' in dist && dist.n).toBe(0);
    // A different browser remains eligible; the tombstone targets only this code.
    const normal = await handle(post({ day: DAY, player: player(97), rounds }), ctx);
    expect(normal.status).toBe(200);
  });

  it('writes a revocation marker for DELETE with zero saved days and blocks stale enrollment', async () => {
    const env = `${run}emptyrev`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits, env,
      budgetPrefix: `sw:v1:${env}:budget` });
    const code = player(98);
    const erase = await handle(post({ player: code, days: [] }, {}, 'DELETE'), ctx);
    expect(erase.status).toBe(200);
    expect(await erase.json()).toMatchObject({ status: 'ok', removed: 0 });
    const { rounds } = await roundsFor(DAY, 2);
    const attempt = await handle(post({ day: DAY, player: code, rounds }), ctx);
    expect(attempt.status).toBe(409);
    expect(await attempt.json()).toMatchObject({ status: 'revoked' });
  });


  describe('question comparison (Feature G) on real Redis', () => {
    const slate = () => fileSlates()(DAY).then((x) => x!);
    const fieldsOf = async (rounds: unknown) => {
      const sl = await slate();
      return verifyRun(sl, rounds)!.outcomes.map((o, i) => `${sl.questions[i]!.id}:${o}`);
    };
    const hash = async (key: string) => {
      const flat = (await client.command(['HGETALL', key])) as string[];
      const m = new Map<string, number>();
      for (let i = 0; i < flat.length; i += 2) m.set(flat[i]!, Number(flat[i + 1]));
      return m;
    };
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

    it('adds the five outcomes atomically with the total; 20 racing tabs count once; TTL matches the distribution', async () => {
      const env = `${run}g1`;
      const { ctx } = testContext({ store: redisStore(client.evaluate), limits, minSample: 1, env, budgetPrefix: `sw:v1:${env}:budget` });
      const { rounds } = await roundsFor(DAY, [2, 3, 4, 5, 6], [true, false, true, true, true]);
      const race = await Promise.all(Array.from({ length: 20 }, () => handle(post({ day: DAY, player: player(200), rounds }), ctx).then((r) => r.json() as Promise<{ status: string }>)));
      expect(race.filter((r) => r.status === 'stored')).toHaveLength(1);
      const q = await hash(`sw:v1:${env}:beta:${DAY}:q`);
      expect(sum(q)).toBe(5);
      expect([...q.keys()].sort()).toEqual((await fieldsOf(rounds)).sort());
      const qTtl = (await client.command(['TTL', `sw:v1:${env}:beta:${DAY}:q`])) as number;
      expect(qTtl).toBeGreaterThan(limits.distTtl - 100);
      // The linked record is the total plus the five fields: no windows.
      const keys = (await client.command(['KEYS', `sw:v1:${env}:beta:${DAY}:sub:*`])) as string[];
      const value = (await client.command(['GET', keys[0]!])) as string;
      expect(value.split(' ')).toHaveLength(6);
      const get = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
      const body = (await get.json()) as { questions: { n: number; ready: boolean }[] };
      expect(body.questions.map((x) => x.n)).toEqual([1, 1, 1, 1, 1]);
    });

    it('treats an old total-only record as a duplicate with its total, and deletes it without touching the question tally', async () => {
      const env = `${run}g2`;
      const store = redisStore(client.evaluate);
      const { ctx } = testContext({ store, limits, minSample: 1, env, budgetPrefix: `sw:v1:${env}:budget` });
      const a = await roundsFor(DAY, 2);
      await handle(post({ day: DAY, player: player(210), rounds: a.rounds }), ctx);
      const sub = ((await client.command(['KEYS', `sw:v1:${env}:beta:${DAY}:sub:*`])) as string[])[0]!;
      // Rewrite it as the previous version stored it (and move its question fields out of the tally, as it never added them).
      const fields = await fieldsOf(a.rounds);
      for (const f of fields) await client.command(['HINCRBY', `sw:v1:${env}:beta:${DAY}:q`, f, -1]);
      await client.command(['SET', sub, String(a.total), 'EX', 600]);
      const dup = (await (await handle(post({ day: DAY, player: player(210), rounds: a.rounds }), ctx)).json()) as { status: string; score: number };
      expect(dup).toMatchObject({ status: 'duplicate', score: a.total });
      await handle(post({ day: DAY, player: player(211), rounds: a.rounds }), ctx);
      const del = await handle(post({ player: player(210), days: [DAY] }, {}, 'DELETE'), ctx);
      expect(await del.json()).toMatchObject({ removed: 1 });
      expect(sum(await hash(`sw:v1:${env}:beta:${DAY}:q`))).toBe(5);
      expect(await hash(`sw:v1:${env}:beta:${DAY}:dist`)).toEqual(new Map([[String(a.total), 1]]));
    });

    it('deletion takes back exactly the five outcomes, removes emptied fields, and charges what it ran', async () => {
      const env = `${run}g3`;
      const prefix = `sw:v1:${env}:budget`;
      const { ctx } = testContext({ store: redisStore(client.evaluate), limits, minSample: 1, env, budgetPrefix: prefix });
      const mine = await roundsFor(DAY, [2, 2, 2, 2, 2], [false, false, false, false, false]);
      const other = await roundsFor(DAY, 3);
      await handle(post({ day: DAY, player: player(220), rounds: mine.rounds }, { 'x-real-ip': '198.51.100.220' }), ctx);
      await handle(post({ day: DAY, player: player(221), rounds: other.rounds }, { 'x-real-ip': '198.51.100.221' }), ctx);
      const del = await handle(post({ player: player(220), days: [] }, { 'x-real-ip': '198.51.100.220' }, 'DELETE'), ctx);
      expect(await del.json()).toMatchObject({ removed: 1 });
      const q = await hash(`sw:v1:${env}:beta:${DAY}:q`);
      expect([...q.keys()].sort()).toEqual((await fieldsOf(other.rounds)).sort());
      expect([...q.values()].every((v) => v === 1)).toBe(true);
      expect(Number(await client.command(['GET', `${prefix}:e:${DAY.slice(0, 7)}`]))).toBe(COST.removeSpent(27, 1, 5));
    });

    it('after an emergency rollback (launch day back to null), deletion still finds and removes s1 records', async () => {
      const env = `${run}g5`;
      const { ctx } = testContext({ store: redisStore(client.evaluate), limits, minSample: 1, env, budgetPrefix: `sw:v1:${env}:budget`, launchDay: DAY });
      const a = await roundsFor(DAY, 2);
      expect(await (await handle(post({ day: DAY, player: player(230), rounds: a.rounds }), ctx)).json()).toMatchObject({ status: 'stored' });
      expect((await client.command(['KEYS', `sw:v1:${env}:s1:${DAY}:sub:*`])) as string[]).toHaveLength(1);
      (ctx as { launchDay: string | null }).launchDay = null;
      const del = await handle(post({ player: player(230), days: [] }, {}, 'DELETE'), ctx);
      expect(await del.json()).toMatchObject({ status: 'ok', removed: 1 });
      expect((await client.command(['KEYS', `sw:v1:${env}:s1:${DAY}:sub:*`])) as string[]).toHaveLength(0);
      expect(sum(await hash(`sw:v1:${env}:s1:${DAY}:q`))).toBe(0);
    });

    it('past the question ceiling stores total-only and flags the day; reads then withhold questions; the read ceiling pauses only reads', async () => {
      const env = `${run}g4`;
      const tight = { ...limits, questionDailyCeiling: COST.submit, readDailyBudget: COST.read * 2 };
      const { ctx } = testContext({ store: redisStore(client.evaluate), limits: tight, minSample: 1, env, budgetPrefix: `sw:v1:${env}:budget` });
      const a = await roundsFor(DAY, 2);
      await handle(post({ day: DAY, player: player(230), rounds: a.rounds }), ctx);
      await handle(post({ day: DAY, player: player(231), rounds: a.rounds }), ctx);
      const q = await hash(`sw:v1:${env}:beta:${DAY}:q`);
      expect(q.get('!')).toBe(1);
      expect(Number(await client.command(['GET', `sw:v1:${env}:budget:d:${DAY}`]))).toBe(COST.submit + COST.submitTotalOnly);
      const r1 = await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
      expect(await r1.json()).toMatchObject({ status: 'ok', n: 2, questions: null });
      await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx);
      expect((await handle(new Request(`https://stat-window.vercel.app/api/scores?day=${DAY}`), ctx)).status).toBe(503);
      expect((await handle(post({ day: DAY, player: player(232), rounds: a.rounds }), ctx)).status).toBe(200);
    });

    it('a POST stalled before the script loses to DELETE: revoked, and no question contribution', async () => {
      const env = `${run}g5`;
      const store = redisStore(client.evaluate);
      let release!: () => void;
      let started!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const begun = new Promise<void>((r) => (started = r));
      const { ctx } = testContext({ store: { ...store, submit: async (...x) => (started(), await held, store.submit(...x)) }, limits, env, budgetPrefix: `sw:v1:${env}:budget` });
      const a = await roundsFor(DAY, 2);
      const late = handle(post({ day: DAY, player: player(240), rounds: a.rounds }), ctx);
      await begun;
      expect((await handle(post({ player: player(240), days: [DAY] }, {}, 'DELETE'), ctx)).status).toBe(200);
      release();
      expect((await late).status).toBe(409);
      expect(await client.command(['EXISTS', `sw:v1:${env}:beta:${DAY}:q`])).toBe(0);
    });

    /**
     * Upstash bills an EVAL as 1 + every redis.call it runs. This wraps each production script so it also
     * returns its own redis.call count, and checks store.ts COST against what Redis actually executed.
     */
    it('COST matches the commands the scripts really run (EVAL + every redis.call)', async () => {
      const counted: Eval = async (script, keys, args) => {
        const wrapped = `local n = 0\nlocal real = redis\nlocal redis = { call = function(...) n = n + 1; return real.call(...) end }\nlocal function body()\n${script}\nend\nlocal out = body()\nreturn {n, out}`;
        return client.evaluate(wrapped, keys, args);
      };
      const env = `${run}g6`;
      const p = `sw:v1:${env}:beta:${DAY}`;
      const budget = { day: `${env}:bd`, month: `${env}:bm`, erase: `${env}:be`, reads: `${env}:br` };
      const sk = (n: number) => ({ sub: `${p}:sub:${n}`, dist: `${p}:dist`, q: `${p}:q`, rate: `${env}:rl:${n}`, ipDay: `${env}:ipd:${n}`, ipCalls: `${env}:ipc:${n}`, revocation: `${env}:rev:${n}` });
      const fields = await fieldsOf((await roundsFor(DAY, 2)).rounds);
      const bill = async (script: string, keys: string[], args: (string | number)[]) => 1 + Number(((await counted(script, keys, args)) as [number])[0]);
      const submitArgs = (l: typeof limits) => [123, l.subTtl, l.distTtl, l.dailyBudget, l.monthlyBudget, l.ratePerMinute, l.ipDailyStored, COST.submit, 172800, 2764800, 93600, l.ipDailyCalls, COST.duplicate, COST.submitTotalOnly, l.questionDailyCeiling, l.questionMonthlyCeiling];
      const subKeys = (n: number) => { const k = sk(n); return [k.sub, k.dist, k.rate, k.ipDay, budget.day, budget.month, k.ipCalls, k.revocation, k.q]; };
      // COST is charged up front, so it must never be below what a script really runs
      // (conditional EXPIREs make later calls cheaper than the bound).
      const within = (actual: number, charged: number) => expect(actual).toBeLessThanOrEqual(charged);
      within(await bill(SUBMIT_LUA, subKeys(1), [...submitArgs(limits), ...fields]), COST.submit);
      within(await bill(SUBMIT_LUA, subKeys(1), [...submitArgs(limits), ...fields]), COST.duplicate);
      within(await bill(SUBMIT_LUA, subKeys(2), [...submitArgs({ ...limits, questionDailyCeiling: 0 }), ...fields]), COST.submitTotalOnly);
      const readArgs = [limits.dailyBudget, limits.monthlyBudget, COST.read, 172800, 2764800, limits.readDailyBudget, limits.questionDailyCeiling, limits.questionMonthlyCeiling];
      within(await bill(READ_LUA, [`${p}:dist`, budget.day, budget.month, budget.reads, `${p}:q`], readArgs), COST.read);
      const triples = Array.from({ length: 18 }, (_, i) => (i === 0 ? [sk(1).sub, `${p}:dist`, `${p}:q`] : i === 1 ? [sk(2).sub, `${p}:dist`, `${p}:q`] : [`${p}:sub:none${i}`, `${p}:dist`, `${p}:q`])).flat();
      const removeArgs = [limits.eraseReserve, 1000, COST.remove(18), 2764800, 1000, 93600, 18, 777600];
      // Record 1 was stored with its five fields; record 2 total-only (the ceiling).
      expect(await bill(REMOVE_LUA, [`${env}:drl`, `${env}:dday`, budget.erase, `${env}:drev`, ...triples], removeArgs)).toBeLessThanOrEqual(COST.removeSpent(18, 2, 5));
      expect(Number(await client.command(['GET', budget.erase]))).toBe(COST.removeSpent(18, 2, 5));
      expect(COST.removeSpent(27, 27, 135)).toBeLessThanOrEqual(COST.remove(27));
    });
  });
});
