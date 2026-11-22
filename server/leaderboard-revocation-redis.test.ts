import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {boards,blockLedger,blockNumber,blockExpiry,expiryFor,PERIODS,erasureBoardKeys,revocationKey} from './leaderboard.ts';
import {leaderboardRedis} from './leaderboard-store.ts';
import {respClient} from './resp.ts';

const url=process.env.REDIS_URL;
const root='sw:v3:revocation-test-'+Date.now().toString(36);
const caps=[10000,20000,10000], day='2027-11-18', member='a'.repeat(40);
function keys(scope:string,rate:string) {
  const p=root+':'+scope;
  return [blockLedger(p,member,blockNumber(day)),...boards(p,day,null),
    p+':budget:d',p+':budget:m',p+':submit:minute:'+rate,p+':budget:lb-m',
    p+':submit:day:'+rate,revocationKey(p,member)];
}
function expiries(){return [...PERIODS.map(period=>expiryFor(period,day)),blockExpiry(blockNumber(day))];}
function erase(scope:string,rate:string){
  const p=root+':'+scope;
  return [blockLedger(p,member,blockNumber(day)),blockLedger(p,member,blockNumber(day)-1),
    p+':budget:erase',p+':erase:minute:'+rate,p+':erase:day:'+rate,p+':erase:subcap',
    revocationKey(p,member),...erasureBoardKeys(p,day)];
}
describe.skipIf(!url)('atomic revocation against disposable Redis 7',()=>{
  let client:ReturnType<typeof respClient>;
  beforeAll(()=>{client=respClient(url!);});
  afterAll(()=>client?.close());
  it('a score arriving after successful DELETE cannot recreate any board',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='late',p=root+':late';
    expect(await store.submit(keys(scope,'early'),member,day,95,caps,expiries())).toBe('stored');
    expect(await store.remove(erase(scope,'early'),member,caps)).toBe('removed');
    expect(await store.submit(keys(scope,'late'),member,day,95,caps,expiries())).toBe('revoked');
    for(const board of boards(p,day,null))expect(await client.command(['ZSCORE',board,member])).toBeNull();
    expect(await client.command(['EXISTS',blockLedger(p,member,blockNumber(day))])).toBe(0);
    const ttl=Number(await client.command(['TTL',revocationKey(p,member)]));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(97200);
  });
  it('DELETE ahead of an in-flight POST leaves a temporary revocation guard',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='early',p=root+':early';
    expect(await store.remove(erase(scope,'early'),member,caps)).toBe('nothing');
    expect(await store.submit(keys(scope,'late'),member,day,95,caps,expiries())).toBe('revoked');
    expect(await client.command(['ZSCORE',boards(p,day,null)[0]!,member])).toBeNull();
    expect(await client.command(['GET',p+':budget:erase'])).toBeNull();
  });
  it('racing POST and DELETE never leave a public entry after erasure',async()=>{
    const store=leaderboardRedis(client.evaluate),scope='race',p=root+':race';
    const [gone,posted]=await Promise.all([
      store.remove(erase(scope,'racer'),member,caps),
      store.submit(keys(scope,'racer'),member,day,98,caps,expiries()),
    ]);
    expect(['removed','nothing']).toContain(gone);
    expect(['stored','revoked']).toContain(posted);
    for(const board of boards(p,day,null))expect(await client.command(['ZSCORE',board,member])).toBeNull();
  });
});
