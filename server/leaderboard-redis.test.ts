/**
 * Real Redis integration coverage for the same Lua scripts called by
 * /api/leaderboard. The normal CI 'check' job supplies REDIS_URL.
 *
 * Never point this test at a real Upstash database. It only uses the
 * disposable redis-server service in GitHub Actions or local development.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boards, expiryFor, PERIODS } from './leaderboard.ts';
import { leaderboardRedis } from './leaderboard-store.ts';
import { respClient } from './resp.ts';

const url = process.env.REDIS_URL;
const prefix = `sw:v3:ci-lb-${Date.now().toString(36)}`;
const caps = [10_000, 20_000, 2_000];
const day1 = '2026-11-18';
const day2 = '2026-11-19';
const member = 'a'.repeat(40);

function budget(scope: string) {
  return [
    `${prefix}:${scope}:budget:day`,
    `${prefix}:${scope}:budget:month`,
    `${prefix}:${scope}:budget:erase`,
    `${prefix}:${scope}:budget:leaderboard-month`,
  ];
}

function writeKeys(scope: string, day: string, rateId: string) {
  const p = `${prefix}:${scope}`, b = budget(scope);
  return [`${p}:player:${member}`, ...boards(p, day, null), b[0]!, b[1]!, `${p}:submit:rate:${rateId}`, b[3]!];
}

function expiration(day: string) {
  return PERIODS.map((p) => expiryFor(p, day));
}

describe.skipIf(!url)('leaderboard Lua on real Redis, isolated test namespace', () => {
  let client: ReturnType<typeof respClient>;
  beforeAll(() => { client = respClient(url!); });
  afterAll(() => client?.close());

  it('one winner from 20 concurrent POSTs; all others are idempotent, no double counting', async () => {
    const store = leaderboardRedis(client.evaluate);
    const scope = 'race';
    // Distinct rate keys isolate the atomic first-score-wins assertion from
    // the separate per-network minute limit of four submissions.
    const race = await Promise.all(Array.from({ length: 20 }, (_, n) =>
      store.submit(writeKeys(scope, day1, String(n)), member, day1, 87, caps, expiration(day1)),
    ));
    expect(race.filter((r) => r === 'stored')).toHaveLength(1);
    expect(race.filter((r) => r === 'duplicate')).toHaveLength(19);
    const p = `${prefix}:${scope}`, b = budget(scope);
    const rows = await store.read(boards(p, day1, null)[0]!, b, caps,
      [`${p}:read:minute:race`, `${p}:read:day:race`]);
    if (typeof rows === 'string') throw new Error(`read was unexpectedly ${rows}`);
    expect(rows).toMatchObject({count:1, rows:[[member,87]]});
    expect(Number(await client.command(['GET', b[1]!]))).toBe(55 + 12);
    expect(Number(await client.command(['GET', b[3]!]))).toBe(55 + 12);
  });

  it('adds daily scores to week/month/season, then deletes every linked period', async () => {
    const store = leaderboardRedis(client.evaluate);
    const scope = 'delete', p = `${prefix}:${scope}`, b = budget(scope);
    expect(await store.submit(writeKeys(scope,day1,'1'),member,day1,100,caps,expiration(day1))).toBe('stored');
    expect(await store.submit(writeKeys(scope,day2,'2'),member,day2,240,caps,expiration(day2))).toBe('stored');
    const periodBoards=boards(p, day2, null);
    for (const board of periodBoards.slice(1)) {
      const value=Number(await client.command(['ZSCORE',board,member]));
      expect(value).toBe(340);
    }
    for (const [day, score] of [[day1,100],[day2,240]] as const) {
      const value=Number(await client.command(['ZSCORE',boards(p,day,null)[0]!,member]));
      expect(value).toBe(score);
    }
    const ttl=Number(await client.command(['TTL',`${p}:player:${member}`]));
    expect(ttl).toBeGreaterThan(60 * 86400); // hash must survive short-lived daily boards
    const removed=await store.remove([`${p}:player:${member}`,p,b[2]!,`${p}:delete:rate:1`],member,caps);
    expect(removed).toBe('removed');
    for (const day of [day1,day2]) {
      for (const board of boards(p,day,null))
        expect(await client.command(['ZSCORE',board,member])).toBeNull();
    }
    expect(await client.command(['EXISTS',`${p}:player:${member}`])).toBe(0);
    expect(Number(await client.command(['GET', b[2]!]))).toBe(2000);
  });

  it('shared monthly cap and leaderboard suballocation deny writes before score mutation', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='budget',b=budget(scope),p=`${prefix}:${scope}`;
    await client.command(['SET',b[1]!,379990]);
    expect(await store.submit(writeKeys(scope,day1,'1'),member,day1,85,caps,expiration(day1))).toBe('paused');
    expect(await client.command(['ZSCORE',boards(p,day1,null)[0]!,member])).toBeNull();
    expect(await client.command(['HEXISTS',`${p}:player:${member}`,day1])).toBe(0);
    expect(await client.command(['GET',b[3]!])).toBeNull();
    await client.command(['SET',b[1]!,0]);
    await client.command(['SET',b[3]!,19_990]);
    expect(await store.submit(writeKeys(scope,day1,'2'),member,day1,85,caps,expiration(day1))).toBe('paused');
    expect(await client.command(['ZSCORE',boards(p,day1,null)[0]!,member])).toBeNull();
  });

  it('read endpoint stops at the per-network daily GET cap', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='getcap',b=budget(scope),p=`${prefix}:${scope}`;
    const rateKeys=[`${p}:read:minute:one`,`${p}:read:day:one`];
    for(let n=0;n<12;n++) {
      const r=await store.read(boards(p,day1,null)[0]!,b,caps,rateKeys);
      expect(r).not.toBe('limited');
      expect(r).not.toBe('paused');
    }
    expect(await store.read(boards(p,day1,null)[0]!,b,caps,rateKeys)).toBe('limited');
    expect(Number(await client.command(['GET',b[3]!]))).toBe(12*12);
  });
});
