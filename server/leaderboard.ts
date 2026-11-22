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
export const LB_COST = { read: 12, submit: 55, remove: 2000 };
export type LBStore = {
  read(board: string, budget: string[], caps: number[]): Promise<'paused' | { rows: [string,number][]; count: number }>;
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
export function pseudonym(member:string):string {
  const adjectives=['Quiet','Swift','Clever','Steady','Sharp','Lucky','Calm','Bold'];
  const nouns=['Hooper','Shooter','Playmaker','Rookie','Veteran','Closer','Defender','Coach'];
  return adjectives[parseInt(member.slice(0,4),16)%8]!+nouns[parseInt(member.slice(4,8),16)%8]!+'-'+member.slice(-4).toUpperCase();
}
function hash(secret:string,value:string) { return createHmac('sha256',secret).update(value).digest('hex').slice(0,40); }
function json(status:number,body:unknown) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
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
  try {
    if(req.method==='GET') {
      const u=new URL(req.url),period=u.searchParams.get('period');
      if(!PERIODS.includes(period as Period)||u.search!==('?period='+period))return json(422,{status:'invalid'});
      const key=periodKey(period as Period,today,ctx.launchDay);
      const r=await ctx.store.read(prefix+':board:'+period+':'+key,budget,ctx.caps);
      if(r==='paused')return json(503,{status:'paused'});
      return json(200,{status:'ok',period,periodKey:key,entries:r.rows.map(([id,score])=>({name:pseudonym(id),score})),totalPlayers:r.count,asOf:now.toISOString(),unverified:true});
    }
    const body=await readBody(req);
    if(!body||typeof body.player!=='string'||!PLAYER.test(body.player))return json(422,{status:'invalid'});
    if(body.consent!=='granted')return json(409,{status:'consent-required'});
    const member=hash(ctx.secret,'lb-player:'+body.player);
    const ip=(req.headers.get('x-real-ip')??req.headers.get('x-forwarded-for')??'unknown').split(',')[0]!.trim();
    const rate=prefix+':rate:'+hash(ctx.secret,'lb-ip:'+ip)+':'+Math.floor(now.getTime()/60000);
    if(req.method==='DELETE') {
      const result=await ctx.store.remove([prefix+':player:'+member,prefix,budget[2]!,rate],member,ctx.caps);
      return result==='limited'?json(429,{status:'limited'}):result==='paused'?json(503,{status:'paused'}):json(200,{status:'ok',removed:result==='removed'?1:0});
    }
    if(body.test===true||typeof body.day!=='string'||!DAY.test(body.day)||!eligibleDay(body.day,now,7200))return json(200,{status:'ineligible'});
    const slate=await ctx.loadSlate(body.day);
    if(!slate||slate.date!==body.day)return json(200,{status:'ineligible'});
    const score=verifyRounds(slate,body.rounds);
    if(score===null||(body.total!==undefined&&body.total!==score))return json(422,{status:'invalid'});
    const result=await ctx.store.submit([prefix+':player:'+member,...boards(prefix,body.day,ctx.launchDay),budget[0]!,budget[1]!,rate,budget[3]!],member,body.day,score,ctx.caps,PERIODS.map(p=>expiryFor(p,body.day)));
    return result==='limited'?json(429,{status:'limited'}):result==='paused'?json(503,{status:'paused'}):json(200,{status:result,day:body.day,score});
  }catch{return json(503,{status:'unavailable'});}
}
export function leaderboardContext(env:Record<string,string|undefined>,store:LBStore|null,loadSlate:LBContext['loadSlate']):LBContext {
  const ns=env.VERCEL_ENV==='production'?'production':env.VERCEL_ENV==='preview'?'preview':env.VERCEL==='1'?'':'development';
  const secret=env.SCORE_HASH_SECRET&& (env.VERCEL!=='1'||env.SCORE_HASH_SECRET.length>=32)?env.SCORE_HASH_SECRET:env.VERCEL==='1'?'':'local-dev-only';
  const day=Math.min(1000,Number(env.LEADERBOARDS_DAILY_BUDGET)||0),month=Math.min(20000,Number(env.LEADERBOARDS_MONTHLY_BUDGET)||0),erase=Math.min(2000,Number(env.LEADERBOARDS_ERASE_BUDGET)||0);
  return {enabled:env.LEADERBOARDS_ENABLED==='1'&&env.SCORES_ENABLED==='1'&&!!ns&&!!secret&&day>=LB_COST.submit&&month>=LB_COST.submit&&erase>=LB_COST.remove,
    store,secret:ns?secret:'',env:ns,launchDay:parseLaunchDay(env.LAUNCH_DAY??env.VITE_LAUNCH_DAY),now:()=>new Date(),loadSlate,
    allowedOrigins:(env.SCORES_ALLOWED_ORIGINS??'https://stat-window.vercel.app').split(',').map(s=>s.trim()).filter(Boolean),caps:[day,month,erase] };
}
