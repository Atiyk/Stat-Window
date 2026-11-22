/**
 * Real Redis integration coverage for the same Lua scripts called by
 * /api/leaderboard. The normal CI 'check' job supplies REDIS_URL.
 *
 * Never point this test at a real Upstash database. It only uses the
 * disposable redis-server service in GitHub Actions or local development.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boards, expiryFor, PERIODS, blockLedger, blockNumber, blockExpiry, erasureBoardKeys } from './leaderboard.ts';
import { leaderboardRedis } from './leaderboard-store.ts';
import { respClient } from './resp.ts';

const url = process.env.REDIS_URL;
const prefix = `sw:v3:ci-lb-${Date.now().toString(36)}`;
const caps = [10_000, 20_000, 10_000];
const day1 = '2027-11-18';
const day2 = '2027-11-19';
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
  return [blockLedger(p,member,blockNumber(day)), ...boards(p, day, null), b[0]!, b[1]!, `${p}:submit:rate:${rateId}`, b[3]!, `${p}:submit:day:${rateId}`];
}

function expiration(day: string) {
  return [...PERIODS.map((p) => expiryFor(p, day)),blockExpiry(blockNumber(day))];
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
      [`${p}:read:minute:race`, `${p}:read:day:race`], [blockLedger(p,member,blockNumber(day1)),blockLedger(p,member,blockNumber(day1)-1)], member);
    if (typeof rows === 'string') throw new Error(`read was unexpectedly ${rows}`);
    expect(rows).toMatchObject({count:1, rows:[[member,87]],mine:{rank:1,score:87,days:1}});
    expect(Number(await client.command(['GET', b[1]!]))).toBe(55 + 24);
    expect(Number(await client.command(['GET', b[3]!]))).toBe(55 + 24);
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
    const mine=await store.read(periodBoards[1]!,b,caps,[`${p}:read:minute:own`,`${p}:read:day:own`],[blockLedger(p,member,blockNumber(day2)),blockLedger(p,member,blockNumber(day2)-1)],member);
    if(typeof mine==='string')throw new Error('weekly board unexpectedly unavailable');
    expect(mine.mine).toMatchObject({rank:1,score:340,days:2});
    const ttl=Number(await client.command(['TTL',blockLedger(p,member,blockNumber(day1))]));
    expect(ttl).toBeGreaterThan(0); // hash must survive short-lived daily boards
    const removed=await store.remove([blockLedger(p,member,blockNumber(day2)),blockLedger(p,member,blockNumber(day2)-1),b[2]!,`${p}:delete:rate:1`,`${p}:delete:day:1`,`${p}:delete:subcap`,...erasureBoardKeys(p,day2)],member,caps);
    expect(removed).toBe('removed');
    for (const day of [day1,day2]) {
      for (const board of boards(p,day,null))
        expect(await client.command(['ZSCORE',board,member])).toBeNull();
    }
    expect(await client.command(['EXISTS',blockLedger(p,member,blockNumber(day1))])).toBe(0);
    expect(Number(await client.command(['GET', b[2]!]))).toBe(35); // 2 days + shared week/month/season = 5 distinct boards
  });



  it('121 uninterrupted daily scores remain partitioned and never extend the older ledger TTL',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='long-run',p=`${prefix}:${scope}`;
    const start=Date.parse('2027-04-26T00:00:00Z');
    for(let i=0;i<121;i++){
      const day=new Date(start+i*86400000).toISOString().slice(0,10);
      expect(await store.submit(writeKeys(scope,day,String(i)),member,day,1,caps,expiration(day))).toBe('stored');
    }
    const older=blockLedger(p,member,blockNumber('2027-04-26'));
    const newer=blockLedger(p,member,blockNumber('2027-08-24'));
    expect(Number(await client.command(['HLEN',older]))).toBe(120);
    expect(Number(await client.command(['HLEN',newer]))).toBe(1);
    expect(Number(await client.command(['EXPIRETIME',older]))).toBe(blockExpiry(blockNumber('2027-04-26')));
    expect(Number(await client.command(['EXPIRETIME',newer]))).toBe(blockExpiry(blockNumber('2027-08-24')));
    expect(blockExpiry(blockNumber('2027-04-26'))).toBeLessThan(blockExpiry(blockNumber('2027-08-24')));
    const b=budget(scope);
    const result=await store.remove([older,newer,b[2]!,`${p}:delete:minute:long`,`${p}:delete:day:long`,`${p}:delete:subcap:long`,...erasureBoardKeys(p,'2027-08-24')],member,caps);
    expect(result).toBe('removed');
    expect(await client.command(['EXISTS',older])).toBe(0);
    expect(await client.command(['EXISTS',newer])).toBe(0);
    for(const date of ['2027-04-26','2027-07-01','2027-08-23','2027-08-24']){
      for(const board of boards(p,date,null))expect(await client.command(['ZSCORE',board,member])).toBeNull();
    }
    expect(Number(await client.command(['GET',b[2]!]))).toBeGreaterThan(0);
    expect(Number(await client.command(['GET',b[2]!]))).toBeLessThan(500);
  });

  it('deleting after a daily board expires never recreates an expired negative-score board',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='expired-board',p=`${prefix}:${scope}`,b=budget(scope);
    expect(await store.submit(writeKeys(scope,day1,'expired'),member,day1,90,caps,expiration(day1))).toBe('stored');
    const expired=boards(p,day1,null)[0]!;
    await client.command(['DEL',expired]); // simulate the earlier board's natural TTL
    const result=await store.remove([blockLedger(p,member,blockNumber(day1)),blockLedger(p,member,blockNumber(day1)-1),b[2]!,`${p}:delete:minute:expired`,`${p}:delete:day:expired`,`${p}:delete:subcap:expired`,...erasureBoardKeys(p,day1)],member,caps);
    expect(result).toBe('removed');
    expect(await client.command(['EXISTS',expired])).toBe(0);
    for(const board of boards(p,day1,null).slice(1))
      expect(await client.command(['ZSCORE',board,member])).toBeNull();
    expect(await client.command(['EXISTS',blockLedger(p,member,blockNumber(day1))])).toBe(0);
  });

  it('two participants can erase in one month, and empty erasure does not debit reserves',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='multi-erase',p=`${prefix}:${scope}`,b=budget(scope);
    const other='c'.repeat(40),day='2027-11-18';
    const first=writeKeys(scope,day,'first');
    const second=writeKeys(scope,day,'second');
    second[0]=blockLedger(p,other,blockNumber(day));
    expect(await store.submit(first,member,day,90,caps,expiration(day))).toBe('stored');
    expect(await store.submit(second,other,day,80,caps,expiration(day))).toBe('stored');
    const erase=(who:string,n:string)=>store.remove([
      blockLedger(p,who,blockNumber(day)),blockLedger(p,who,blockNumber(day)-1),
      b[2]!,`${p}:erase:minute:${n}`,`${p}:erase:day:${n}`,`${p}:erase:subcap`,...erasureBoardKeys(p,day)
    ],who,caps);
    expect(await erase(member,'1')).toBe('removed');
    expect(await erase(other,'2')).toBe('removed');
    expect(Number(await client.command(['GET',b[2]!]))).toBe(64); // 2 erasures * (20 + 3*4 unique boards)
    expect(await erase(member,'3')).toBe('nothing');
    expect(Number(await client.command(['GET',b[2]!]))).toBe(64);
    for(const board of boards(p,day,null)){
      expect(await client.command(['ZCARD',board])).toBe(0);
    }
  });

  it('denied DELETE requests stop incrementing network counters and do not charge erase budgets',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='delete-limit',p=`${prefix}:${scope}`,b=budget(scope);
    const keys=[blockLedger(p,member,blockNumber(day1)),blockLedger(p,member,blockNumber(day1)-1),b[2]!,`${p}:delete:minute`,`${p}:delete:day`,`${p}:delete:subcap`,...erasureBoardKeys(p,day1)];
    for(let i=0;i<2;i++)expect(await store.remove(keys,member,caps)).toBe('nothing');
    for(let i=0;i<50;i++)expect(await store.remove(keys,member,caps)).toBe('limited');
    expect(Number(await client.command(['GET',keys[3]!]))).toBe(2);
    expect(Number(await client.command(['GET',keys[4]!]))).toBe(2);
    expect(await client.command(['GET',b[2]!])).toBeNull();
    expect(await client.command(['GET',keys[5]!])).toBeNull();
  });

  it('cross-block week participation and atomic deletion remove both seasons',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='boundary',p=`${prefix}:${scope}`,b=budget(scope);
    const old='2027-08-23',next='2027-08-24';
    expect(blockNumber(next)).toBe(blockNumber(old)+1);
    expect(await store.submit(writeKeys(scope,old,'old'),member,old,100,caps,expiration(old))).toBe('stored');
    expect(await store.submit(writeKeys(scope,next,'next'),member,next,140,caps,expiration(next))).toBe('stored');
    const weekly=boards(p,next,null)[1]!;
    const result=await store.read(weekly,b,caps,[`${p}:read:minute`,`${p}:read:day`],
      [blockLedger(p,member,blockNumber(next)),blockLedger(p,member,blockNumber(old))],member);
    if(typeof result==='string')throw new Error(result);
    expect(result.mine).toMatchObject({score:240,days:2,rank:1});
    expect(await store.remove([blockLedger(p,member,blockNumber(next)),blockLedger(p,member,blockNumber(old)),
      b[2]!,`${p}:delete:minute`,`${p}:delete:day`,`${p}:delete:subcap`,...erasureBoardKeys(p,next)],member,caps)).toBe('removed');
    for(const day of [old,next])for(const board of boards(p,day,null))
      expect(await client.command(['ZSCORE',board,member])).toBeNull();
  });

  it('ties share rank while personal days played reflects actual accepted dates', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='ties',p=`${prefix}:${scope}`,b=budget(scope);
    const second='b'.repeat(40);
    expect(await store.submit(writeKeys(scope,day1,'1'),member,day1,100,caps,expiration(day1))).toBe('stored');
    expect(await store.submit(writeKeys(scope,day2,'2'),member,day2,240,caps,expiration(day2))).toBe('stored');
    const keys=writeKeys(scope,day2,'3');
    keys[0]=blockLedger(p,second,blockNumber(day2));
    expect(await store.submit(keys,second,day2,340,caps,expiration(day2))).toBe('stored');
    const week=boards(p,day2,null)[1]!;
    const one=await store.read(week,b,caps,[`${p}:read:minute:one`,`${p}:read:day:one`],[blockLedger(p,member,blockNumber(day2)),blockLedger(p,member,blockNumber(day2)-1)],member);
    const two=await store.read(week,b,caps,[`${p}:read:minute:two`,`${p}:read:day:two`],[blockLedger(p,second,blockNumber(day2)),blockLedger(p,second,blockNumber(day2)-1)],second);
    if(typeof one==='string'||typeof two==='string')throw new Error('board unexpectedly unavailable');
    expect(one.rows).toHaveLength(2);
    expect(two.rows).toHaveLength(2);
    expect(one.mine).toMatchObject({rank:1,score:340,days:2});
    expect(two.mine).toMatchObject({rank:1,score:340,days:1});
  });

  it('undeclared or corrupted period key in a player ledger aborts deletion without partial changes',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='undeclared',p=`${prefix}:${scope}`,b=budget(scope);
    const key=writeKeys(scope,day1,'first');
    expect(await store.submit(key,member,day1,90,caps,expiration(day1))).toBe('stored');
    const original=JSON.parse(String(await client.command(['HGET',key[0]!,day1]))) as [number,string,string,string,string];
    const tampered=[...original];
    tampered[1]=`${p}:board:day:1999-01-01`;
    await client.command(['HSET',key[0]!,day1,JSON.stringify(tampered)]);
    const response=await store.remove([blockLedger(p,member,blockNumber(day1)),blockLedger(p,member,blockNumber(day1)-1),b[2]!,`${p}:delete:minute:bad`,`${p}:delete:day:bad`,`${p}:delete:subcap:bad`,...erasureBoardKeys(p,day1)],member,caps);
    expect(response).toBe('paused');
    expect(await client.command(['ZSCORE',boards(p,day1,null)[0]!,member])).toBe('90');
    expect(await client.command(['EXISTS',key[0]!])).toBe(1);
    expect(await client.command(['GET',b[2]!])).toBeNull();
  });

  it('shared monthly cap and leaderboard suballocation deny writes before score mutation', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='budget',b=budget(scope),p=`${prefix}:${scope}`;
    await client.command(['SET',b[1]!,379990]);
    expect(await store.submit(writeKeys(scope,day1,'1'),member,day1,85,caps,expiration(day1))).toBe('paused');
    expect(await client.command(['ZSCORE',boards(p,day1,null)[0]!,member])).toBeNull();
    expect(await client.command(['HEXISTS',blockLedger(p,member,blockNumber(day1)),day1])).toBe(0);
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
      const r=await store.read(boards(p,day1,null)[0]!,b,caps,rateKeys,[blockLedger(p,'anonymous',blockNumber(day1)),blockLedger(p,'anonymous',blockNumber(day1)-1)],null);
      expect(r).not.toBe('limited');
      expect(r).not.toBe('paused');
    }
    expect(await store.read(boards(p,day1,null)[0]!,b,caps,rateKeys,[blockLedger(p,'anonymous',blockNumber(day1)),blockLedger(p,'anonymous',blockNumber(day1)-1)],null)).toBe('limited');
    expect(Number(await client.command(['GET',b[3]!]))).toBe(12*24);
    for(let i=0;i<50;i++)expect(await store.read(boards(p,day1,null)[0]!,b,caps,rateKeys,[blockLedger(p,'anonymous',blockNumber(day1)),blockLedger(p,'anonymous',blockNumber(day1)-1)],null)).toBe('limited');
    expect(Number(await client.command(['GET',rateKeys[0]!]))).toBe(12);
    expect(Number(await client.command(['GET',rateKeys[1]!]))).toBe(12);
    expect(Number(await client.command(['GET',b[3]!]))).toBe(12*24);
  });
});

describe.skipIf(!url)('leaderboard retention and daily caps on real Redis', () => {
  let client: ReturnType<typeof respClient>;
  beforeAll(() => { client = respClient(url!); });
  afterAll(() => client?.close());
  it('older late-arriving score never shortens player hash expiration', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='monotonic', p=`${prefix}:${scope}`;
    const later='2028-03-12', earlier='2027-11-18';
    expect(await store.submit(writeKeys(scope,later,'new'),member,later,90,caps,expiration(later))).toBe('stored');
    const before=Number(await client.command(['EXPIRETIME',blockLedger(p,member,blockNumber(later))]));
    expect(await store.submit(writeKeys(scope,earlier,'old'),member,earlier,80,caps,expiration(earlier))).toBe('stored');
    const after=Number(await client.command(['EXPIRETIME',blockLedger(p,member,blockNumber(later))]));
    expect(after).toBe(before);
    expect(await client.command(['HEXISTS',blockLedger(p,member,blockNumber(earlier)),earlier])).toBe(1);
  });
  it('POST per-network daily limit is atomic even with distinct minute keys', async () => {
    const store=leaderboardRedis(client.evaluate);
    const scope='daily-limit';
    const first=writeKeys(scope,'2028-02-01','0');
    const daily=first[9]!;
    for(let i=0;i<20;i++){
      const keys=writeKeys(scope,'2028-02-01',String(i));
      keys[0]=blockLedger(`${prefix}:${scope}`,String(i),blockNumber('2028-02-01'));
      keys[9]=daily;
      expect(await store.submit(keys,`member-${i}`,'2028-02-01',90,caps,expiration('2028-02-01'))).toBe('stored');
    }
    const keys=writeKeys(scope,'2028-02-01','last');
    keys[9]=daily;
    expect(await store.submit(keys,'another','2028-02-01',90,caps,expiration('2028-02-01'))).toBe('limited');
    for(let i=0;i<50;i++)expect(await store.submit(keys,'another','2028-02-01',90,caps,expiration('2028-02-01'))).toBe('limited');
    expect(Number(await client.command(['GET',daily]))).toBe(20);
    expect(Number(await client.command(['GET',keys[7]!]))).toBe(1);
  });
});
