/** Separate opt-in leaderboard API; deliberately disabled until its shared Upstash cost budget is approved. */
import { createHmac } from 'node:crypto';
import { puzzleDay, addDays } from '../src/engine/daily.ts';
import { parseLaunchDay } from '../src/engine/season.ts';
import { eligibleDay, verifyRounds, type ServerSlate } from './api.ts';

export type Period = 'day' | 'week' | 'month' | 'season';
export const PERIODS: Period[] = ['day','week','month','season'];
const PLAYER = /^[A-Za-z0-9_-]{22}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Fixed 120-day leaderboard seasons, never an unbounded beta/s1 key. */
export const SEASON_DAYS = 120;
export const RETAIN_DAYS = 30;
export function expiryFor(period: Period, day: string): number {
  const start = Date.parse(day+'T00:00:00Z') / 1000;
  const d = new Date(day+'T00:00:00Z');
  let end: number;
  if (period === 'day') end = start + 86400;
  else if (period === 'week') end = start + (7 - ((d.getUTCDay()+6)%7))*86400;
  else if (period === 'month') end = Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;
  else {
    const anchor=Date.parse('2026-01-01T00:00:00Z')/1000;
    end=anchor+(Math.floor((start-anchor)/(SEASON_DAYS*86400))+1)*SEASON_DAYS*86400;
  }
  return end + RETAIN_DAYS*86400;
}
export const LB_COST = { read: 24, submit: 55, remove: 20 };
export const ERASE_RESERVE = 20000;
export const MIN_ERASE_SUBCAP = 5000;
export function blockNumber(day:string):number { return Number(periodKey('season',day,null).slice(6)); }
export function blockLedger(prefix:string,member:string,block:number):string { return prefix+':player:'+member+':block-'+block; }
/** Finite lifetime for a 120-day ledger, including month/week overlap. */
export function blockExpiry(block:number):number {
  const anchor=Date.parse('2026-01-01T00:00:00Z');
  let expiry=0;
  for(let i=0;i<SEASON_DAYS;i++){
    const day=new Date(anchor+(block*SEASON_DAYS+i)*86400000).toISOString().slice(0,10);
    for(const period of PERIODS) expiry=Math.max(expiry,expiryFor(period,day));
  }
  return expiry;
}
export type LBStore = {
  /** Optional member is the HMAC of a participant's random browser code, never their raw code. */
  read(board: string, budget: string[], caps: number[], rateKeys: string[], profileKeys: string[], member: string | null): Promise<'paused'|'limited' | { rows: [string,number][]; count: number; mine?: {rank:number;score:number;days:number} }>;
  submit(keys: string[], member: string, day: string, score: number, caps: number[], expiries: number[]): Promise<'stored'|'duplicate'|'limited'|'paused'>;
  remove(keys: string[], member: string, caps: number[]): Promise<'removed'|'nothing'|'limited'|'paused'>;
};
export type LBContext = { enabled: boolean; store: LBStore | null; secret: string; env: string; launchDay: string | null; now:()=>Date; loadSlate:(day:string)=>Promise<ServerSlate|null>; allowedOrigins: string[]; caps: number[] };
export function periodKey(period: Period, day: string, launchDay: string|null): string {
  if (!DAY.test(day) || Number.isNaN(Date.parse(day+'T00:00:00Z'))) throw new RangeError('invalid day');
  if (period === 'day') return day;
  if (period === 'month') return day.slice(0,7);
  if (period === 'season') {
    const anchor=Date.parse('2026-01-01T00:00:00Z');
    return 'block-'+Math.floor((Date.parse(day+'T00:00:00Z')-anchor)/(SEASON_DAYS*86400000));
  }
  const weekday = new Date(day+'T00:00:00Z').getUTCDay();
  return addDays(day,-((weekday+6)%7));
}
export function boards(prefix:string,day:string,launchDay:string|null):string[] {
  return PERIODS.map(p=>prefix+':board:'+p+':'+periodKey(p,day,launchDay));
}
/**
 * Explicitly declare every board a retained two-block player ledger may cite.
 * Upstash strict Lua locking rejects writes to keys absent from EVAL's KEYS.
 * The bound is two fixed 120-day blocks; never scan Redis or trust client keys.
 */
export function erasureBoardKeys(prefix:string,day:string):string[] {
  const anchor=Date.parse('2026-01-01T00:00:00Z');
  const current=blockNumber(day), result=new Set<string>();
  for(let block=current-1;block<=current;block++) {
    for(let i=0;i<SEASON_DAYS;i++) {
      const date=new Date(anchor+(block*SEASON_DAYS+i)*86400000).toISOString().slice(0,10);
      for(const board of boards(prefix,date,null)) result.add(board);
    }
  }
  return [...result];
}
export function pseudonym(member:string):string {
  const adjectives=['Quiet','Swift','Clever','Steady','Sharp','Lucky','Calm','Bold'];
  const nouns=['Hooper','Shooter','Playmaker','Rookie','Veteran','Closer','Defender','Coach'];
  return adjectives[parseInt(member.slice(0,4),16)%8]!+nouns[parseInt(member.slice(4,8),16)%8]!+'-'+member.slice(-4).toUpperCase();
}
function hash(secret:string,value:string) { return createHmac('sha256',secret).update(value).digest('hex').slice(0,40); }
function json(status:number,body:unknown) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===429?{'Retry-After':'120'}:{})}}); }
async function readBody(req:Request):Promise<Record<string,unknown>|null> {
  if (!(req.headers.get('content-type')??'').startsWith('application/json') || Number(req.headers.get('content-length')??0)>2048) return null;
  try { const text=await req.text(); if(new TextEncoder().encode(text).length>2048)return null; const x:unknown=JSON.parse(text); return x && typeof x==='object' && !Array.isArray(x)?x as Record<string,unknown>:null; } catch { return null; }
}
export async function handleLeaderboard(req:Request,ctx:LBContext):Promise<Response> {
  if(!['GET','POST','DELETE'].includes(req.method))return json(405,{status:'method'});
  if(req.headers.get('sec-fetch-site')==='cross-site')return json(403,{status:'origin'});
  const origin=req.headers.get('origin');
  if(origin) { try { const o=new URL(origin); if(o.host!==(req.headers.get('x-forwarded-host')??req.headers.get('host')??new URL(req.url).host)&&!ctx.allowedOrigins.includes(o.origin))return json(403,{status:'origin'}); }catch{return json(403,{status:'origin'});} }
  if(!ctx.store||!ctx.secret||!ctx.env||(!ctx.enabled&&req.method!=='DELETE'))return json(503,{status:'disabled'});
  const now=ctx.now(), today=puzzleDay(now), prefix='sw:v3:'+ctx.env,utc=now.toISOString().slice(0,10);
  const budget=[ 'sw:v1:budget:d:'+utc,'sw:v1:budget:m:'+utc.slice(0,7),'sw:v1:budget:e:'+utc.slice(0,7),prefix+':budget:m:'+utc.slice(0,7) ];
  // Never trust the user-controlled leftmost X-Forwarded-For address for throttling.
  // Use the edge-provided address, or one conservative shared fallback bucket.
  const ip=(req.headers.get('x-real-ip')??'unknown').trim().slice(0,128);
  const network=hash(ctx.secret,'lb-ip:'+ip);
  try {
    if(req.method==='GET') {
      const u=new URL(req.url),period=u.searchParams.get('period');
      if(!PERIODS.includes(period as Period)||u.search!==('?period='+period))return json(422,{status:'invalid'});
      const key=periodKey(period as Period,today,ctx.launchDay);
      // A random browser code is sent only in a request header, never in the
      // public URL, page metadata or the leaderboard response. The server
      // hashes it before looking up this participant's own rank.
      const code=req.headers.get('x-stat-window-player');
      if(code!==null && !PLAYER.test(code))return json(422,{status:'invalid'});
      // Privacy signals override any browser code: old clients, extensions or
      // direct requests must not trigger a personal-score lookup under GPC/DNT.
      // Anonymous public top-20 reads remain available. DELETE still accepts
      // the original code after consent is withdrawn, for full erasure.
      const privateRead=req.headers.get('sec-gpc')==='1'||req.headers.get('dnt')==='1';
      const member=code===null||privateRead?null:hash(ctx.secret,'lb-player:'+code);
      const board=prefix+':board:'+period+':'+key;
      const r=await ctx.store.read(board,budget,ctx.caps,[prefix+':read:minute:'+network+':'+Math.floor(now.getTime()/60000),prefix+':read:day:'+network+':'+utc],[blockLedger(prefix,member??'anonymous',blockNumber(today)),blockLedger(prefix,member??'anonymous',blockNumber(today)-1)],member);
      if(r==='limited')return json(429,{status:'limited'});
      if(r==='paused')return json(503,{status:'paused'});
      let topRank=0;
      const entries=r.rows.map(([id,score],index)=>{
        if(index===0 || r.rows[index-1]![1]!==score)topRank=index+1;
        return {rank:topRank,name:pseudonym(id),score};
      });
      const mine=r.mine && member?{...r.mine,name:pseudonym(member)}:undefined;
      return json(200,{status:'ok',period,periodKey:key,entries,totalPlayers:r.count,asOf:now.toISOString(),unverified:true,...(mine?{mine}:{})});
    }
    const body=await readBody(req);
    if(!body||typeof body.player!=='string'||!PLAYER.test(body.player))return json(422,{status:'invalid'});
    // Withdrawal of consent must never prevent erasure (including GPC/DNT opt-out).
    if(req.method==='POST' && (body.consent!=='granted' || req.headers.get('sec-gpc')==='1' || req.headers.get('dnt')==='1'))return json(409,{status:'consent-required'});
    const member=hash(ctx.secret,'lb-player:'+body.player);
    const rate=prefix+':rate:'+network+':'+Math.floor(now.getTime()/60000);
    if(req.method==='DELETE') {
      const result=await ctx.store.remove([blockLedger(prefix,member,blockNumber(today)),blockLedger(prefix,member,blockNumber(today)-1),budget[2]!,rate,prefix+':delete:day:'+network+':'+utc,prefix+':budget:erase:'+utc.slice(0,7),...erasureBoardKeys(prefix,today)],member,ctx.caps);
      return result==='limited'?json(429,{status:'limited'}):result==='paused'?json(503,{status:'paused'}):json(200,{status:'ok',removed:result==='removed'?1:0});
    }
    const submittedDay = body.day;
    if(body.test===true||typeof submittedDay!=='string'||!DAY.test(submittedDay)||!eligibleDay(submittedDay,now,7200))return json(200,{status:'ineligible'});
    const slate=await ctx.loadSlate(submittedDay);
    if(!slate||slate.date!==submittedDay)return json(200,{status:'ineligible'});
    const score=verifyRounds(slate,body.rounds);
    if(score===null||(body.total!==undefined&&body.total!==score))return json(422,{status:'invalid'});
    const result=await ctx.store.submit([blockLedger(prefix,member,blockNumber(submittedDay)),...boards(prefix,submittedDay,ctx.launchDay),budget[0]!,budget[1]!,rate,budget[3]!,prefix+':submit:day:'+network+':'+utc],member,submittedDay,score,ctx.caps,[...PERIODS.map(p=>expiryFor(p,submittedDay)),blockExpiry(blockNumber(submittedDay))]);
    return result==='limited'?json(429,{status:'limited'}):result==='paused'?json(503,{status:'paused'}):json(200,{status:result,day:body.day,score});
  }catch{return json(503,{status:'unavailable'});}
}
export function leaderboardContext(env:Record<string,string|undefined>,store:LBStore|null,loadSlate:LBContext['loadSlate']):LBContext {
  const ns=env.VERCEL_ENV==='production'?'production':env.VERCEL_ENV==='preview'?'preview':env.VERCEL==='1'?'':'development';
  const secret=env.SCORE_HASH_SECRET&& (env.VERCEL!=='1'||env.SCORE_HASH_SECRET.length>=32)?env.SCORE_HASH_SECRET:env.VERCEL==='1'?'':'local-dev-only';
  const day=Math.min(1000,Number(env.LEADERBOARDS_DAILY_BUDGET)||0),month=Math.min(20000,Number(env.LEADERBOARDS_MONTHLY_BUDGET)||0),erase=Math.min(10000,Number(env.LEADERBOARDS_ERASE_BUDGET)||0);
  return {enabled:env.LEADERBOARDS_ENABLED==='1'&&env.SCORES_ENABLED==='1'&&!!ns&&!!secret&&day>=LB_COST.submit&&month>=LB_COST.submit&&erase>=MIN_ERASE_SUBCAP,
    store,secret:ns?secret:'',env:ns,launchDay:parseLaunchDay(env.LAUNCH_DAY??env.VITE_LAUNCH_DAY),now:()=>new Date(),loadSlate,
    allowedOrigins:(env.SCORES_ALLOWED_ORIGINS??'https://stat-window.vercel.app').split(',').map(s=>s.trim()).filter(Boolean),caps:[day,month,erase] };
}
