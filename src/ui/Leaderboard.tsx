import { useEffect, useState } from 'react';
import type { RoundRecord } from '../engine/game';
import { choice, enroll, leave, optIn, standings, privacySignal, type Period, type Standings } from '../lib/leaderboard';
import '../leaderboard.css';
const PERIODS:Period[]=['day','week','month','season'];
export function Leaderboard({day,results,eligible}:{day:string;results:readonly RoundRecord[];eligible:boolean}){
  const [period,setPeriod]=useState<Period>('day'),[data,setData]=useState<Standings|null>(null),[joined,setJoined]=useState(()=>choice().consent),[pendingDeletion,setPendingDeletion]=useState(()=>!choice().consent&&!!choice().key),[status,setStatus]=useState('');
  const privateBrowser=privacySignal();
  useEffect(()=>{let active=true;setData(null);void standings(period).then(x=>{if(active)setData(x);});return()=>{active=false;};},[period]);
  const join=async()=>{if(privateBrowser){setStatus('Your browser privacy preference blocks joining global rankings. No score was sent.');return;}if(!optIn()){setStatus('This browser cannot save your choice.');return;}setJoined(true);setStatus('Submitting your score…');const pending=enroll(day,results),joinedKey=choice().key;
    const r=await pending;
    // An in-flight POST must never overwrite withdrawal/deletion messaging.
    if(!choice().consent||choice().key!==joinedKey)return;
    setStatus(r==='stored'||r==='duplicate'?'Your score is on the board.':r==='disabled'?'Rankings are not enabled yet.':'Could not submit your score. Try again later.');
    setData(await standings(period));};
  const exit=async()=>{
    setStatus('Stopping submissions and requesting erasure…');
    const r=await leave();
    const local=choice();
    setJoined(local.consent);
    setPendingDeletion(!local.consent&&!!local.key);
    if(r==='failed'){
      setStatus(local.consent
        ? 'Deletion failed; this browser could not save your opt-out. Please retry.'
        : 'New submissions are off. Your ranking might still be public; retry deletion when the service is available.');
      return;
    }
    setStatus('Your linked rankings were removed.');
    setData(await standings(period));
  };
  if(!eligible)return null;
  return <section className="leaderboard" aria-labelledby="lb-title">
    <h2 id="lb-title">Global leaderboard <span className="lb-beta">Unverified beta</span></h2>
    <p className="lb-sub">Real opt-in players. Higher scores rank first; ties share a place. For longer periods, scores add up across days played. No prizes or verified identities.</p>
    <div className="lb-tabs" role="group" aria-label="Leaderboard period">{PERIODS.map(p=><button type="button" key={p} className="btn btn-quiet btn-small" aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p[0]!.toUpperCase()+p.slice(1)}</button>)}</div>
    {!data?<p role="status">Loading rankings…</p>:data.status!=='ok'?<p role="status">{data.status==='disabled'?'Global rankings are not enabled yet.':'Rankings are temporarily unavailable. Your game is saved locally.'}</p>:data.entries.length===0?<p role="status">No opt-in scores yet for this {period}. Be the first.</p>:<>
      <p className="lb-sub">{data.totalPlayers.toLocaleString('en-US')} opted-in players this {period} · top 20 shown{period!=='day'?' · totals reflect different numbers of days played; individual public day counts are not available':''}</p>
      <ol className="lb-list">{data.entries.map((e)=><li key={e.name}><span>{e.rank}. {e.name}</span><strong aria-label={`${e.score.toLocaleString('en-US')} total points`}>{e.score.toLocaleString('en-US')} pts</strong></li>)}</ol>
    </>}
    {data?.status==='ok'&&data.mine&&<p className="lb-sub" role="status">Your rank: #{data.mine.rank.toLocaleString('en-US')} · {data.mine.score.toLocaleString('en-US')} points · {data.mine.days} {data.mine.days===1?'day':'days'} played this {period}. Unverified anonymous beta.</p>}
    {joined||pendingDeletion?<button type="button" className="btn btn-quiet btn-small" onClick={()=>void exit()}>{pendingDeletion?'Retry deleting my rankings':'Leave and delete my rankings'}</button>:<div className="lb-consent"><p>Join voluntarily with a generated nickname. Your five windows are checked, then discarded; scores stay linked to a random browser code until 30 days after the end of each ranking period (120-day seasons). Anyone can view rankings. You can delete your entries here. A short-lived nonpublic hashed revocation marker stops delayed score submissions after deletion. Use Leave before clearing your browser's site data, or you will lose the code required to delete public scores before expiry. This is separate from the daily percentile choice. {privateBrowser?'Your browser is sending Global Privacy Control or Do Not Track, so new leaderboard submissions are blocked. You can still delete an existing ranking.':''}</p>{data?.status==='ok'&&!privateBrowser&&<button type="button" className="btn btn-quiet btn-small" onClick={()=>void join()}>Join global rankings</button>}</div>}
    {status&&<p role="status">{status}</p>}
    <p className="lb-sub"><a href="/privacy.html">Privacy, retention and deletion</a></p>
  </section>;
}
