import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { periodKey, boards, expiryFor, pseudonym, handleLeaderboard, leaderboardContext, blockNumber, erasureBoardKeys } from './leaderboard.ts';
describe('Eastern calendar leaderboard periods',()=>{
 it('weeks start Monday including Sunday before and after DST',()=>{expect(periodKey('week','2026-03-08',null)).toBe('2026-03-02');expect(periodKey('week','2026-03-09',null)).toBe('2026-03-09');expect(periodKey('week','2026-11-01',null)).toBe('2026-10-26');});
 it('months and seasons use calendar keys',()=>{expect(periodKey('month','2026-12-31',null)).toBe('2026-12');expect(periodKey('month','2027-01-01',null)).toBe('2027-01');expect(boards('test','2026-11-22',null)).toHaveLength(4);});
 it('fixed seasons rotate and retention has bounded expiry',()=>{
   expect(periodKey('season','2026-01-01',null)).toBe('block-0');
   expect(periodKey('season','2026-04-30',null)).toBe('block-0');
   expect(periodKey('season','2026-05-01',null)).toBe('block-1');
   expect(expiryFor('season','2026-01-01')).toBe(expiryFor('season','2026-04-30'));
   expect(expiryFor('day','2026-03-08')).toBe(Date.parse('2026-04-08T00:00:00Z')/1000);
   expect(expiryFor('week','2026-11-01')).toBe(Date.parse('2026-12-02T00:00:00Z')/1000);
 });
 it('erasure declares all day/week/month/season boards across exactly two 120-day blocks',()=>{
   const prefix='sw:v3:test',lastOld='2027-08-23',firstNew='2027-08-24';
   expect(blockNumber(firstNew)).toBe(blockNumber(lastOld)+1);
   const all=erasureBoardKeys(prefix,firstNew);
   expect(new Set(all).size).toBe(all.length);
   expect(all.length).toBeLessThan(300);
   for(const date of [lastOld,firstNew,'2027-04-26']){
     for(const key of boards(prefix,date,null))expect(all).toContain(key);
   }
   expect(all).not.toContain(boards(prefix,'2027-04-25',null)[0]);
   expect(all).not.toContain(boards(prefix,'2027-12-22',null)[0]);
 });
 it('pseudonyms are stable and do not expose raw member',()=>{const id='a'.repeat(40);expect(pseudonym(id)).toBe(pseudonym(id));expect(pseudonym(id)).not.toContain(id);});
 it('defaults to disabled without explicit budgets',()=>{const c=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',SCORE_HASH_SECRET:'a'.repeat(32)},null,async()=>null);expect(c.enabled).toBe(false);});
 it('rejects unconsented POST even if a store is present',async()=>{const c=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'a'.repeat(32)},{} as never,async()=>null);const r=await handleLeaderboard(new Request('https://stat-window.vercel.app/api/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:'a'.repeat(22)})}),c);expect(r.status).toBe(409);});
 it('does not leak leaderboard data when disabled',async()=>{const c=leaderboardContext({},null,async()=>null);const r=await handleLeaderboard(new Request('https://example.com/api/leaderboard?period=day'),c);expect(r.status).toBe(503);});
 it('returns only the authenticated participant’s own tied rank and played days',async()=>{
   const code='abcdefghijklmnopqrstuv',secret='a'.repeat(32);
   const member=createHmac('sha256',secret).update('lb-player:'+code).digest('hex').slice(0,40);
   const captured:string[]=[];
   const store={
     read:async(...args:unknown[])=>{
       captured.push(String(args[4]),String(args[5]));
       return {rows:[[member,340],['b'.repeat(40),340]] as [string,number][],count:2,mine:{rank:1,score:340,days:2}};
     },
   } as never;
   const ctx=leaderboardContext({
     VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',
     LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',
     LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:secret,
   },store,async()=>null);
   ctx.now=()=>new Date('2026-11-22T16:00:00Z');
   const url='https://stat-window.vercel.app/api/leaderboard?period=week';
   const res=await handleLeaderboard(new Request(url,{headers:{'X-Stat-Window-Player':code}}),ctx);
   expect(res.status).toBe(200);
   const data=await res.json();
   expect(data.mine).toMatchObject({rank:1,score:340,days:2,name:pseudonym(member)});
   expect(data.entries).toMatchObject([{rank:1,score:340},{rank:1,score:340}]);
   expect(JSON.stringify(data)).not.toContain(code);
   expect(captured).toEqual([['sw:v3:production:player:'+member+':block-'+blockNumber('2026-11-22'),'sw:v3:production:player:'+member+':block-'+(blockNumber('2026-11-22')-1)].join(','),member]);
   const publicRes=await handleLeaderboard(new Request(url),ctx);
   expect((await publicRes.json()).mine).toBeUndefined();
   const invalid=await handleLeaderboard(new Request(url,{headers:{'X-Stat-Window-Player':'not-valid'}}),ctx);
   expect(invalid.status).toBe(422);
 });

});

describe('privacy erasure after consent withdrawal',()=>{
 it('permits DELETE with GPC/DNT and denied consent while POST stays blocked',async()=>{
   let removed=0;
   const ctx=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',SCORE_HASH_SECRET:'x'.repeat(32)},
     {remove:async()=>{removed++;return 'removed';}} as never,async()=>null);
   ctx.now=()=>new Date('2026-11-22T16:00:00Z');
   const request=(method:'POST'|'DELETE')=>new Request('https://stat-window.vercel.app/api/leaderboard',{
     method,headers:{'Content-Type':'application/json','Sec-GPC':'1','DNT':'1'},
     body:JSON.stringify({player:'a'.repeat(22),consent:'denied'})});
   const erased=await handleLeaderboard(request('DELETE'),ctx);
   expect(erased.status).toBe(200);
   expect(await erased.json()).toMatchObject({status:'ok',removed:1});
   expect(removed).toBe(1);
   const rejected=await handleLeaderboard(request('POST'),{...ctx,enabled:true});
   expect(rejected.status).toBe(409);
   expect(removed).toBe(1);
 });
});


describe('leaderboard opt-out and network identity hardening',()=>{
 it('rejects consent-granted POST under GPC or DNT without touching the store',async()=>{
   let calls=0;
   const ctx=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'a'.repeat(32)}, {submit:async()=>{calls++;return 'stored';}} as never,async()=>null);
   for(const signal of ['Sec-GPC','DNT'] as const){
     // Headers avoids a union with an optional undefined field under
     // TypeScript's exactOptionalPropertyTypes and matches the actual Fetch API.
     const headers=new Headers({'Content-Type':'application/json'});
     headers.set(signal,'1');
     const r=await handleLeaderboard(new Request('https://stat-window.vercel.app/api/leaderboard',{method:'POST',headers,body:JSON.stringify({player:'a'.repeat(22),consent:'granted'})}),ctx);
     expect(r.status).toBe(409);
   }
   expect(calls).toBe(0);
 });
 it('does not allow spoofed forwarded-for to change rate-limit bucket',async()=>{
   const rateKeys:string[][]=[];
   const ctx=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'a'.repeat(32)}, {read:async(_board:string,_budget:string[],_caps:number[],keys:string[])=>{rateKeys.push(keys);return {rows:[],count:0};}} as never,async()=>null);
   ctx.now=()=>new Date('2026-11-22T16:00:00Z');
   for(const forged of ['1.2.3.4','5.6.7.8']){
     const r=await handleLeaderboard(new Request('https://stat-window.vercel.app/api/leaderboard?period=day',{headers:{'X-Forwarded-For':forged}}),ctx);
     expect(r.status).toBe(200);
   }
   expect(rateKeys).toHaveLength(2);
   expect(rateKeys[0]).toEqual(rateKeys[1]);
 });
});


describe('server-enforced anonymous reads under browser privacy signals',()=>{
 it('does not look up or return a personal rank if GPC or DNT is set, even with a valid player header',async()=>{
   const code='abcdefghijklmnopqrstuv',seen:(string|null)[]=[];
   const ctx=leaderboardContext({
     VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',
     LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',
     LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'s'.repeat(32),
   },{
     read:async(_board:string,_budget:string[],_caps:number[],_rates:string[],_profile:string[],member:string|null)=>{
       seen.push(member);
       return {rows:[['a'.repeat(40),90]] as [string,number][],count:1,
         // Deliberately include a mock profile: the API must suppress it as well.
         mine:{rank:1,score:90,days:1}};
     },
   } as never,async()=>null);
   ctx.now=()=>new Date('2026-11-22T16:00:00Z');
   for(const signal of ['Sec-GPC','DNT'] as const){
     const headers=new Headers({'X-Stat-Window-Player':code});
     headers.set(signal,'1');
     const res=await handleLeaderboard(new Request('https://stat-window.vercel.app/api/leaderboard?period=week',{headers}),ctx);
     expect(res.status).toBe(200);
     const body=await res.json();
     expect(body.status).toBe('ok');
     expect(body.entries).toHaveLength(1);
     expect(body.mine).toBeUndefined();
     expect(JSON.stringify(body)).not.toContain(code);
   }
   expect(seen).toEqual([null,null]);
 });
});

describe('warm-instance Redis 429 denial caching (defense in depth, not a quota guarantee)',()=>{
 it('returns the cached 429 without a second Redis call for the same GET source and minute',async()=>{
   let calls=0;
   const store={read:async()=>{calls++;return 'limited';}} as never;
   const ctx=leaderboardContext({
     VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',
     LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',
     LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'z'.repeat(32),
   },store,async()=>null);
   let timestamp=Date.parse('2026-11-22T16:00:05Z');
   ctx.now=()=>new Date(timestamp);
   const request=(ip:string)=>new Request('https://stat-window.vercel.app/api/leaderboard?period=day',
     {headers:{'X-Real-IP':ip}});
   expect((await handleLeaderboard(request('203.0.113.5'),ctx)).status).toBe(429);
   expect((await handleLeaderboard(request('203.0.113.5'),ctx)).status).toBe(429);
   expect(calls).toBe(1);
   // Different network still reaches Redis, never shares someone else's denial.
   expect((await handleLeaderboard(request('203.0.113.6'),ctx)).status).toBe(429);
   expect(calls).toBe(2);
   timestamp=Date.parse('2026-11-22T16:01:00Z');
   expect((await handleLeaderboard(request('203.0.113.5'),ctx)).status).toBe(429);
   expect(calls).toBe(3);
 });
 it('does not memoize paused or disabled responses and partitions DELETE from GET',async()=>{
   let reads=0,removals=0;
   const store={
     read:async()=>{reads++;return 'paused';},
     remove:async()=>{removals++;return 'limited';},
   } as never;
   const ctx=leaderboardContext({
     VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',
     LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',
     LEADERBOARDS_ERASE_BUDGET:'10000',SCORE_HASH_SECRET:'y'.repeat(32),
   },store,async()=>null);
   ctx.now=()=>new Date('2026-11-22T16:04:05Z');
   const url='https://stat-window.vercel.app/api/leaderboard';
   for(let i=0;i<2;i++){
     const r=await handleLeaderboard(new Request(url+'?period=day'),ctx);
     expect(r.status).toBe(503);
   }
   expect(reads).toBe(2);
   for(let i=0;i<2;i++){
     const r=await handleLeaderboard(new Request(url,{
       method:'DELETE',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({player:'a'.repeat(22),consent:'denied'}),
     }),ctx);
     expect(r.status).toBe(429);
   }
   expect(removals).toBe(1);
   // GETs are never blocked merely because the same source had a DELETE denial.
   const r=await handleLeaderboard(new Request(url+'?period=day'),ctx);
   expect(r.status).toBe(503);
   expect(reads).toBe(3);
 });
});
