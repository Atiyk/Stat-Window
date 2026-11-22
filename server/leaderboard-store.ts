/** Redis Lua atomics. Uses existing shared Upstash budget counters; deletion uses its reserved budget. */
import type { LBStore } from './leaderboard.ts';
import type { Eval } from './store.ts';
export const READ_LUA=`
local own=tonumber(redis.call('GET',KEYS[4]) or '0')
if own+12>tonumber(ARGV[2]) then return {'paused'} end
local d=tonumber(redis.call('GET',KEYS[2]) or '0')
local m=tonumber(redis.call('GET',KEYS[3]) or '0')
if d+12>tonumber(ARGV[1]) or m+12>380000 then return {'paused'} end
redis.call('INCRBY',KEYS[4],12) redis.call('EXPIRE',KEYS[4],2764800)
redis.call('INCRBY',KEYS[2],12) redis.call('EXPIRE',KEYS[2],172800)
redis.call('INCRBY',KEYS[3],12) redis.call('EXPIRE',KEYS[3],2764800)
local n=redis.call('ZCARD',KEYS[1])
local top=redis.call('ZREVRANGE',KEYS[1],0,19,'WITHSCORES')
return {'ok',n,top}
`;
export const SUBMIT_LUA=`
local rate=redis.call('INCR',KEYS[8]) redis.call('EXPIRE',KEYS[8],120)
if rate>4 then return 'limited' end
if redis.call('HEXISTS',KEYS[1],ARGV[2])==1 then return 'duplicate' end
if tonumber(redis.call('GET',KEYS[9]) or '0')+55>tonumber(ARGV[4]) or tonumber(redis.call('GET',KEYS[6]) or '0')+55>tonumber(ARGV[3]) or tonumber(redis.call('GET',KEYS[7]) or '0')+55>380000 then return 'paused' end
redis.call('INCRBY',KEYS[9],55) redis.call('EXPIRE',KEYS[9],2764800)
redis.call('INCRBY',KEYS[6],55) redis.call('EXPIRE',KEYS[6],172800)
redis.call('INCRBY',KEYS[7],55) redis.call('EXPIRE',KEYS[7],2764800)
redis.call('HSET',KEYS[1],ARGV[2],cjson.encode({tonumber(ARGV[1]),KEYS[2],KEYS[3],KEYS[4],KEYS[5]}))
redis.call('EXPIREAT',KEYS[1],math.max(tonumber(ARGV[6]),tonumber(ARGV[7]),tonumber(ARGV[8]),tonumber(ARGV[9])))
for i=2,5 do redis.call('ZINCRBY',KEYS[i],tonumber(ARGV[1]),ARGV[5]) redis.call('EXPIREAT',KEYS[i],tonumber(ARGV[i+4])) end
return 'stored'
`;
export const REMOVE_LUA=`
local rate=redis.call('INCR',KEYS[4]) redis.call('EXPIRE',KEYS[4],120)
if rate>2 then return 'limited' end
if tonumber(redis.call('GET',KEYS[3]) or '0')+2000>tonumber(ARGV[1]) then return 'paused' end
redis.call('INCRBY',KEYS[3],2000) redis.call('EXPIRE',KEYS[3],2764800)
local all=redis.call('HGETALL',KEYS[1])
if #all==0 then return 'nothing' end
for i=2,#all,2 do
  local item=cjson.decode(all[i])
  local score=item[1]
  for j=2,5 do
    local board=item[j]
    local new=redis.call('ZINCRBY',board,-score,ARGV[2])
    if tonumber(new)<=0 then redis.call('ZREM',board,ARGV[2]) end
  end
end
redis.call('DEL',KEYS[1])
return 'removed'
`;
export function leaderboardRedis(evaluate:Eval):LBStore {
  return {
    async read(board,budget,caps) {
      const out=await evaluate(READ_LUA,[board,budget[0]!,budget[1]!,budget[3]!],[caps[0]!,caps[1]!]) as unknown[];
      if(out[0]==='paused')return 'paused';
      const flat=out[2] as unknown[];
      const rows:[string,number][]=[];
      for(let i=0;i<flat.length;i+=2)rows.push([String(flat[i]),Number(flat[i+1])]);
      return {rows,count:Number(out[1])};
    },
    async submit(keys,member,day,score,caps,expiries) {
      return String(await evaluate(SUBMIT_LUA,keys,[score,day,caps[0]!,caps[1]!,member,...expiries])) as 'stored'|'duplicate'|'limited'|'paused';
    },
    async remove(keys,member,caps) {
      return String(await evaluate(REMOVE_LUA,keys,[caps[2]!,member])) as 'removed'|'nothing'|'limited'|'paused';
    },
  };
}
