import { useEffect, useState } from 'react';
import type { RoundRecord } from '../engine/game';
import { choice, enroll, leave, optIn, standings, privacySignal, type Period, type Standings } from '../lib/leaderboard';
import '../leaderboard.css';
const PERIODS:Period[]=['day','week','month','season'];
export function Leaderboard({day,results,eligible}:{day:string;results:readonly RoundRecord[];eligible:boolean}){
  const [period,setPeriod]=useState<Period>('day'),[data,setData]=useState<Standings|null>(null),[joined,setJoined]=useState(()=>choice().consent),[status,setStatus]=useState('');
  useEffect(()=>{let active=true;setData(null);void standings(period).then(x=>{if(active)setData(x);});return()=>{active=false;};},[period]);
  const join=async()=>{if(!optIn()){setStatus('This browser cannot save your choice.');return;}setJoined(true);setStatus('Submitting your score…');const r=await enroll(day,results);setStatus(r==='stored'||r==='duplicate'?'Your score is on the board.':r==='disabled'?'Rankings are not enabled yet.':'Could not submit your score. Try again later.');setData(await standings(period));};
  const exit=async()=>{setStatus('Removing your ranking…');const r=await leave();if(r==='failed'){setStatus('Deletion failed. Please retry; your score may still be public.');return;}setJoined(false);setStatus('Your linked rankings were removed.');setData(await standings(period));};
  if(!eligible)return null;
  return <section className="leaderboard" aria-labelledby="lb-title">
    <h2 id="lb-title">Global leaderboard <span className="lb-beta">Unverified beta</span></h2>
    <p className="lb-sub">Real opt-in players. Higher scores rank first; ties share a place. For longer periods, scores add up across days played. No prizes or verified identities.</p>
    <div className="lb-tabs" role="group" aria-label="Leaderboard period">{PERIODS.map(p=><button type="button" key={p} className="btn btn-quiet btn-small" aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p[0]!.toUpperCase()+p.slice(1)}</button>)}</div>
    {!data?<p role="status">Loading rankings…</p>:data.status!=='ok'?<p role="status">{data.status==='disabled'?'Global rankings are not enabled yet.':'Rankings are temporarily unavailable. Your game is saved locally.'}</p>:data.entries.length===0?<p role="status">No opt-in scores yet for this {period}. Be the first.</p>:<>
      <p className="lb-sub">{data.totalPlayers.toLocaleString('en-US')} opted-in players this {period} · top 20 shown</p>
      <ol className="lb-list">{data.entries.map((e)=><li key={e.name}><span>{e.rank}. {e.name}</span><strong>{e.score.toLocaleString('en-US')}</strong></li>)}</ol>
    </>}
    {data?.status==='ok'&&data.mine&&<p className="lb-sub" role="status">Your rank: #{data.mine.rank.toLocaleString('en-US')} · {data.mine.score.toLocaleString('en-US')} points · {data.mine.days} {data.mine.days===1?'day':'days'} played this {period}. Unverified anonymous beta.</p>}
    {joined?<button type="button" className="btn btn-quiet btn-small" onClick={()=>void exit()}>Leave and delete my rankings</button>:<div className="lb-consent"><p>Join voluntarily with a generated nickname. Your five windows are checked, then discarded; scores stay linked to a random browser code until 30 days after the end of each ranking period (120-day seasons). Anyone can view rankings. You can delete your entries here. This is separate from the daily percentile choice. {privacySignal()?'Your browser requests privacy; nothing is submitted unless you choose Join.':''}</p>{data?.status==='ok'&&<button type="button" className="btn btn-quiet btn-small" onClick={()=>void join()}>Join global rankings</button>}</div>}
    {status&&<p role="status">{status}</p>}
    <p className="lb-sub"><a href="/privacy.html">Privacy, retention and deletion</a></p>
  </section>;
}
