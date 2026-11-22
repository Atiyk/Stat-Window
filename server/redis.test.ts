/**
 * Runs the production Lua scripts on a real redis-server (REDIS_URL, e.g. redis://127.0.0.1:6379).
 * CI starts one as a service; locally: `redis-server --port 6390 --daemonize yes` then
 * `REDIS_URL=redis://127.0.0.1:6390 npx vitest run server`. Each test uses its own key namespace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, handle } from './api.ts';
import { DAY, player, post, roundsFor, testContext } from './fixtures.ts';
import { respClient } from './resp.ts';
import { COST, redisStore } from './store.ts';

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
    expect(Number(await client.command(['GET', `${prefix}:e:${DAY.slice(0, 7)}`]))).toBe(2 * COST.removeSpent(2, 0));
    // Another network's real player still deletes their stored score.
    expect(await (await handle(post({ player: player(30), days: [DAY] }, { 'x-real-ip': '198.51.100.30' }, 'DELETE'), ctx)).json()).toMatchObject({ removed: 1 });
    expect(Number(await client.command(['GET', `${prefix}:e:${DAY.slice(0, 7)}`]))).toBe(3 * COST.removeSpent(2, 0) + 3);
  });
});
