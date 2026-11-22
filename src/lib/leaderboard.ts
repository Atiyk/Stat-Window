import type { RoundRecord } from '../engine/game';
import { browserSignal, newKey } from './privacy';
import { isQa } from './scores';
export type Period = 'day'|'week'|'month'|'season';
export type Leader = {name:string;score:number;rank:number};
export type PersonalStanding = {name:string;score:number;rank:number;days:number};
export type Standings = {status:'ok';period:Period;entries:Leader[];totalPlayers:number;asOf:string;mine?:PersonalStanding}|{status:'disabled'|'unavailable'|'paused'};
const KEY='stat-window:leaderboard:v1';
type Choice={consent:boolean;key:string|null;sent:string[]};
const empty=():Choice=>({consent:false,key:null,sent:[]});
export function choice():Choice { try {const x=JSON.parse(localStorage.getItem(KEY)??'null') as Partial<Choice>|null;return x&&typeof x==='object'?{consent:x.consent===true,key:typeof x.key==='string'&&/^[A-Za-z0-9_-]{22}$/.test(x.key)?x.key:null,sent:Array.isArray(x.sent)?x.sent.filter((d):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-90):[]}:empty();}catch{return empty();} }
function save(c:Choice){try{localStorage.setItem(KEY,JSON.stringify(c));}catch{/* unavailable storage: never silently enroll */}}
async function request(method:'GET'|'POST'|'DELETE',body?:unknown,period?:Period,player?:string){
  const headers:Record<string,string>={};
  if(body!==undefined)headers['Content-Type']='application/json';
  // The random browser code is never embedded in a URL or public share link.
  if(player)headers['X-Stat-Window-Player']=player;
  return fetch('/api/leaderboard'+(period?'?period='+period:''),{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(6000)});
}
export async function standings(period:Period):Promise<Standings>{
  try{
    const c=choice();
    const r=await request('GET',undefined,period,c.consent&&c.key?c.key:undefined);
    const x=await r.json();
    if(r.status===503)return {status:x.status==='disabled'?'disabled':'paused'};
    if(!r.ok||x.status!=='ok'||!Array.isArray(x.entries))return {status:'unavailable'};
    return {status:'ok',period,entries:x.entries.slice(0,20),totalPlayers:x.totalPlayers,asOf:x.asOf,
      ...(x.mine&&Number.isInteger(x.mine.rank)&&Number.isInteger(x.mine.days)&&Number.isFinite(x.mine.score)?{mine:x.mine as PersonalStanding}:{})};
  }catch{return {status:'unavailable'};}
}
export async function enroll(day:string,results:readonly RoundRecord[]):Promise<'stored'|'duplicate'|'failed'|'disabled'>{
  // Honor the browser's privacy signal before persisting any opt-in choice.
  // The server independently rejects submissions under Sec-GPC/DNT.
  if(results.length!==5||isQa()||browserSignal())return 'failed';
  const c=choice();if(!c.consent)return 'failed';
  const key=c.key??newKey(),sent=[...new Set([...c.sent,day])].slice(-90);
  save({consent:true,key,sent});if(choice().key!==key)return 'failed';
  try {const r=await request('POST',{player:key,day,consent:'granted',rounds:results.map(x=>({id:x.questionId,lo:x.lo,hi:x.hi})),total:results.reduce((s,x)=>s+x.points,0)});const x=await r.json();if(x.status==='stored'||x.status==='duplicate')return x.status;if(x.status==='disabled')return 'disabled';return 'failed';}catch{return 'failed';}
}
export function optIn(){if(browserSignal())return false;const c=choice();save({...c,consent:true});return choice().consent;}
export async function leave():Promise<'deleted'|'failed'|'nothing'>{
  const c=choice();if(!c.key){save(empty());return 'nothing';}
  try{const r=await request('DELETE',{player:c.key,consent:'granted'});if(!r.ok)return 'failed';save(empty());return 'deleted';}catch{return 'failed';}
}
export function privacySignal(){return browserSignal();}
