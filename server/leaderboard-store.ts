/** Redis Lua atomics. Uses existing shared Upstash budget counters; deletion uses its reserved budget. */
import type { LBStore } from './leaderboard.ts';
import type { Eval } from './store.ts';
export const READ_LUA=`
if tonumber(redis.call('GET',KEYS[5]) or '0')>=12 then return {'limited'} end
local minute=redis.call('INCR',KEYS[5])
if minute==1 then redis.call('EXPIRE',KEYS[5],120) end
if minute>12 then return {'limited'} end
if tonumber(redis.call('GET',KEYS[6]) or '0')>=60 then return {'limited'} end
local daily=redis.call('INCR',KEYS[6])
if daily==1 then redis.call('EXPIRE',KEYS[6],93600) end
if daily>60 then return {'limited'} end
local own=tonumber(redis.call('GET',KEYS[4]) or '0')
if own+24>tonumber(ARGV[2]) then return {'paused'} end
local d=tonumber(redis.call('GET',KEYS[2]) or '0')
local m=tonumber(redis.call('GET',KEYS[3]) or '0')
if d+24>tonumber(ARGV[1]) or m+24>380000 then return {'paused'} end
redis.call('INCRBY',KEYS[4],24) redis.call('EXPIRE',KEYS[4],2764800)
redis.call('INCRBY',KEYS[2],24) redis.call('EXPIRE',KEYS[2],172800)
redis.call('INCRBY',KEYS[3],24) redis.call('EXPIRE',KEYS[3],2764800)
local n=redis.call('ZCARD',KEYS[1])
local top=redis.call('ZREVRANGE',KEYS[1],0,19,'WITHSCORES')
-- Public participation is intentionally not inferred from cumulative scores.
-- Without an atomic per-board unique-day index, a public days count would
-- silently misrepresent migrated records and post-erasure totals.
local mine={}
if ARGV[3] and ARGV[3]~='' then
  local myScore=redis.call('ZSCORE',KEYS[1],ARGV[3])
  if myScore then
    -- Share the same place among tied scores; never enumerate other players.
    local higher=redis.call('ZCOUNT',KEYS[1],'('..myScore,'+inf')
    -- A participant can play at most once per day. Their bounded player hash
    -- already stores exactly which boards each of those days contributes to.
    local days=0
    for k=7,8 do
      local ownDays=redis.call('HGETALL',KEYS[k])
      for i=2,#ownDays,2 do
        local item=cjson.decode(ownDays[i])
        for j=2,5 do
          if item[j]==KEYS[1] then days=days+1 break end
        end
      end
    end
    mine={tonumber(higher)+1,tonumber(myScore),days}
  end
end
return {'ok',n,top,mine}
`;
export const SUBMIT_LUA=`
if tonumber(redis.call('GET',KEYS[8]) or '0')>=4 then return 'limited' end
local rate=redis.call('INCR',KEYS[8])
if rate==1 then redis.call('EXPIRE',KEYS[8],120) end
if rate>4 then return 'limited' end
if tonumber(redis.call('GET',KEYS[10]) or '0')>=20 then return 'limited' end
local daily=redis.call('INCR',KEYS[10])
if daily==1 then redis.call('EXPIRE',KEYS[10],93600) end
if daily>20 then return 'limited' end
-- A prior DELETE locks this browser code out, even if a late POST arrives
-- from a second tab after the corresponding score/ledger has been removed.
if redis.call('EXISTS',KEYS[11])==1 then return 'revoked' end
if redis.call('HEXISTS',KEYS[1],ARGV[2])==1 then return 'duplicate' end
if tonumber(redis.call('GET',KEYS[9]) or '0')+55>tonumber(ARGV[4]) or tonumber(redis.call('GET',KEYS[6]) or '0')+55>tonumber(ARGV[3]) or tonumber(redis.call('GET',KEYS[7]) or '0')+55>380000 then return 'paused' end
redis.call('INCRBY',KEYS[9],55) redis.call('EXPIRE',KEYS[9],2764800)
redis.call('INCRBY',KEYS[6],55) redis.call('EXPIRE',KEYS[6],172800)
redis.call('INCRBY',KEYS[7],55) redis.call('EXPIRE',KEYS[7],2764800)
redis.call('HSET',KEYS[1],ARGV[2],cjson.encode({tonumber(ARGV[1]),KEYS[2],KEYS[3],KEYS[4],KEYS[5]}))
local hashExpiry=tonumber(ARGV[10])
if redis.call('TTL',KEYS[1])==-1 then redis.call('EXPIREAT',KEYS[1],hashExpiry)
else redis.call('EXPIREAT',KEYS[1],hashExpiry,'GT') end
for i=2,5 do redis.call('ZINCRBY',KEYS[i],tonumber(ARGV[1]),ARGV[5]) redis.call('EXPIREAT',KEYS[i],tonumber(ARGV[i+4])) end
return 'stored'
`;
export const REMOVE_LUA=`
if tonumber(redis.call('GET',KEYS[4]) or '0')>=2 then return 'limited' end
local rate=redis.call('INCR',KEYS[4])
if rate==1 then redis.call('EXPIRE',KEYS[4],120) end
if rate>2 then return 'limited' end
if tonumber(redis.call('GET',KEYS[5]) or '0')>=6 then return 'limited' end
local daily=redis.call('INCR',KEYS[5])
if daily==1 then redis.call('EXPIRE',KEYS[5],93600) end
if daily>6 then return 'limited' end
-- KEYS[7] is the revocation tombstone; KEYS[8+] declare the complete
-- deterministic board universe for both
-- retained 120-day ledger blocks. Under Upstash Lua strict locking every
-- mutated board must have been declared in the EVAL key list.
local declared={}
for k=8,#KEYS do declared[KEYS[k]]=k end
local totalByBoard={}
local uniqueBoards=0
local count=0
for k=1,2 do
  local all=redis.call('HGETALL',KEYS[k])
  for i=2,#all,2 do
    count=count+1
    if count>240 then return 'paused' end
    local item=cjson.decode(all[i])
    if type(item)~='table' or #item~=5 or type(item[1])~='number' or item[1]<0 then return 'paused' end
    -- Preflight every ledger row before touching any public ranking.
    for j=2,5 do
      local board=item[j]
      if not declared[board] then return 'paused' end
      if totalByBoard[board]==nil then
        totalByBoard[board]=0
        uniqueBoards=uniqueBoards+1
      end
      totalByBoard[board]=totalByBoard[board]+item[1]
    end
  end
end
-- Even an empty DELETE must atomically block any in-flight POST that
-- would otherwise resurrect a score after successful erasure.
-- Reserve for EVAL, throttling, both budget counters and the tombstone SET.
-- One ZSCORE and at most one ZREM/ZINCRBY per distinct board.
local cost=count==0 and 18 or 21+3*uniqueBoards
if tonumber(redis.call('GET',KEYS[3]) or '0')+cost>20000 or
   tonumber(redis.call('GET',KEYS[6]) or '0')+cost>tonumber(ARGV[1]) then return 'paused' end
redis.call('INCRBY',KEYS[3],cost) redis.call('EXPIRE',KEYS[3],2764800)
redis.call('INCRBY',KEYS[6],cost) redis.call('EXPIRE',KEYS[6],2764800)
redis.call('SET',KEYS[7],'1','EX',172800)
if count==0 then return 'nothing' end
for name,score in pairs(totalByBoard) do
  local board=KEYS[declared[name]]
  -- Never recreate a board that already expired; mutate a member once.
  local current=redis.call('ZSCORE',board,ARGV[2])
  if current then
    if tonumber(current)<=score then
      redis.call('ZREM',board,ARGV[2])
    else
      redis.call('ZINCRBY',board,-score,ARGV[2])
    end
  end
end
redis.call('DEL',KEYS[1],KEYS[2])
return 'removed'
`;
export function leaderboardRedis(evaluate:Eval):LBStore {
  return {
    async read(board,budget,caps,rateKeys,profileKeys,member) {
      const out=await evaluate(READ_LUA,[board,budget[0]!,budget[1]!,budget[3]!,...rateKeys,...profileKeys],[caps[0]!,caps[1]!,member??'']) as unknown[];
      if(out[0]==='paused')return 'paused';
      if(out[0]==='limited')return 'limited';
      const flat=out[2] as unknown[];
      const rows:[string,number][]=[];
      for(let i=0;i<flat.length;i+=2)rows.push([String(flat[i]),Number(flat[i+1])]);
      const own=out[3] as unknown[] | undefined;
      const mine=Array.isArray(own)&&own.length===3
        ? {rank:Number(own[0]),score:Number(own[1]),days:Number(own[2])}:undefined;
      return {rows,count:Number(out[1]),...(mine?{mine}:{})};
    },
    async submit(keys,member,day,score,caps,expiries) {
      return String(await evaluate(SUBMIT_LUA,keys,[score,day,caps[0]!,caps[1]!,member,...expiries])) as 'stored'|'duplicate'|'limited'|'paused'|'revoked';
    },
    async remove(keys,member,caps) {
      return String(await evaluate(REMOVE_LUA,keys,[caps[2]!,member])) as 'removed'|'nothing'|'limited'|'paused';
    },
  };
}
