/**
 * Runs the production Lua scripts on a real redis-server (REDIS_URL, e.g. redis://127.0.0.1:6379).
 * CI starts one as a service; locally: `redis-server --port 6390 --daemonize yes` then
 * `REDIS_URL=redis://127.0.0.1:6390 npx vitest run server`. Each test uses its own key namespace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle } from './api.ts';
import { DAY, player, post, roundsFor, testContext } from './fixtures.ts';
import { respClient } from './resp.ts';
import { redisStore } from './store.ts';

const url = process.env.REDIS_URL;
const run = `t${Date.now().toString(36)}`;

describe.skipIf(!url)('Lua scripts on a real redis-server', () => {
  let client: ReturnType<typeof respClient>;
  beforeAll(() => {
    client = respClient(url!);
  });
  afterAll(() => client?.close());

  const limits = { subTtl: 604800, distTtl: 34560000, dailyBudget: 10_000, ratePerMinute: 1000 };

  it('stores atomically, dedupes concurrent submissions, sets TTLs and deletes cleanly', async () => {
    const env = `${run}a`;
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits, minSample: 3, env });
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
    const { ctx } = testContext({ store: redisStore(client.evaluate), limits: { ...limits, dailyBudget: 2 }, env: `${run}b` });
    const a = await roundsFor(DAY, 2);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await handle(post({ day: DAY, player: player(10 + i), rounds: a.rounds }), ctx)).status);
    expect(codes).toEqual([200, 200, 503]);
  });
});
