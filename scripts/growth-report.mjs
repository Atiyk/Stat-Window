import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Normalized Vercel Pages counts; no API credentials or network calls.
export function parseGrowthCounts(input) {
  const rows = new Map();
  for (const [i, raw] of input.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || /^"?path"?\s*,\s*"?(count|views|page views)"?$/i.test(line)) continue;
    const match = /^"?(\/(?:e\/[a-z0-9/-]+)?)"?\s*(?:,|\t)\s*(?:"([0-9]+(?:,[0-9]{3})*)"|([0-9]+))$/i.exec(line);
    if (!match) throw new Error(`Malformed or unsupported row ${i+1}; use path,count with / or /e/ paths`);
    const path = match[1];
    const n = Number((match[2] ?? match[3]).replace(/,/g,''));
    if (!Number.isSafeInteger(n) || n < 0 || rows.has(path)) throw new Error(`Invalid or duplicate count on row ${i+1}`);
    rows.set(path, n);
  }
  if (rows.size === 0) throw new Error('No count rows supplied');
  let total=0;
  for (const n of rows.values()) { total+=n; if(!Number.isSafeInteger(total)) throw new Error('Count total exceeds safe integer range'); }
  return rows;
}

export function growthReport(rows,{from,to,period,previous,usage}){
  const day = s => { if(!/^\d{4}-\d{2}-\d{2}$/.test(s??'')) throw new Error('Use YYYY-MM-DD dates'); const d=new Date(s+'T00:00:00Z'); if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s) throw new Error('Invalid date');return +d; };
  const days=(day(to)-day(from))/86400000+1;
  if(!['daily','weekly'].includes(period)||days<1||(period==='daily'?days!==1:days>7)) throw new Error('Daily requires one date; weekly requires 1–7 consecutive dates');
  if(usage!==undefined&&(!Number.isSafeInteger(usage)||usage<0)) throw new Error('Invalid usage count');
  const sum = (map,...prefixes) => {let total=0,seen=false;for(const [path,n] of map){if(prefixes.some(p=>path===p||path.startsWith(p+'/'))){seen=true;total+=n;}}return seen?total:null;};
  const count=(...p)=>sum(rows,...p.map(x=>'/e/s1/'+x));
  const val=n=>n===null?'not supplied / no matching row':String(n);
  const starts=count('start/daily'),finishes=count('complete/daily');
  const ratio=(n,d)=>n===null||d===null?'unavailable':d<30?'insufficient denominator (<30)':n>d?'not interpretable as a completion rate (finishes exceed starts)':`${(100*n/d).toFixed(0)}% (aggregate, not joined)`;
  const out=[`# Stat Window ${period} growth report: ${from} to ${to}`, 'Official s1 events only; root page views include beta and QA. Missing rows are not assumed to be zero.', '', `Game-root page views (not unique visits): ${val(rows.get('/')??null)}`, `New browsers: ${val(count('visit/new'))} | returning browser-day events: ${val(count('visit/return'))}`, `Daily starts: ${val(starts)} | finishes: ${val(finishes)} | aggregate finish ratio: ${ratio(finishes,starts)}`];
  if(previous){const prior=sum(previous,'/e/s1/start/daily');out.push(`Prior equal-length, immediately preceding period (owner supplied): ${val(prior)} starts; change: ${prior===null||starts===null?'unavailable':String(starts-prior)}`);} else out.push('Trend: unavailable (no preceding equal-length export).');
  const methods=['native','clipboard','native-image','image-saved','cancelled','failed'];
  for(const kind of ['share/daily','weekly/share'])out.push(`${kind}: ${methods.map(m=>`${m} ${val(count(kind+'/'+m))}`).join(' | ')}`);
  out.push(`Challenge: playable arrivals ${val(count('challenge-open/today','challenge-open/past'))}; starts ${val(count('start/challenge'))}; finishes ${val(count('complete/challenge'))} (not joined recipients).`);
  const channels=['x','threads','reddit','playlin','alldle','directory','email','creator','groupchat','embed','search','video','guide','launch'];
  const referral=channels.map(c=>[c,...['landing','start','complete'].map(step=>count('referral/'+c+'/'+step))]).filter(a=>a.slice(1).some(x=>x!==null));
  out.push(`Referral landing / start / complete: ${referral.length?referral.map(([c,...n])=>c+' '+n.map(val).join('/')).join('; '):'unavailable'} (aggregate events, not unique players).`);
  const returns=[1,7].map(n=>{let seen=false,total=0;for(const [p,v] of rows)if(p.startsWith('/e/s1/visit/return/')&&p.endsWith('/day'+n)){seen=true;total+=v;}return seen?total:null;});
  out.push(`Return indicators: D1 ${val(returns[0])}; D7 ${val(returns[1])} (event counts only; no day-aligned cohort denominator). Weekly opens: ${val(count('weekly/open'))}.`);
  const misses=[];
  for(let r=1;r<=5;r++){const hit=count('sample/lock/daily/r'+r+'/hit'),miss=count('sample/lock/daily/r'+r+'/miss'); if(hit!==null||miss!==null)misses.push(`Q${r} ${val(miss)} miss / ${val(hit)} hit`);}
  out.push(`Sampled question signals (~10%): ${misses.join('; ')||'unavailable'}.`);
  out.push(`Game failures: ${val(count('failure/game'))}; comparison failures: ${val(count('failure/comparison'))}. Team monthly analytics usage: ${usage===undefined?'unavailable (enter provider usage, not export totals)':`${usage}/50000 (${Math.round(usage/50000*100)}%)`}.`);
  out.push('Cautions: browser events ≠ people; share outcomes ≠ delivery; same-period counts are not individually linked. Export lag, missing rows, blocked storage and opt-out may bias results.');
  const failure=count('failure/game');
  const action=failure!==null&&failure>0?'Investigate game failures before expanding acquisition.':usage!==undefined&&usage>=37500?'Export the baseline and review free-tier headroom.':starts===null||finishes===null||starts<30?'Collect a complete baseline before interpreting conversion.':finishes>starts?'Check reporting windows and delayed completions before interpreting the ratio.':finishes/starts<.75?'Inspect the sampled progression and first-round experience.':'Review the most active referral channels and keep the launch baseline stable.';
  out.push(`Next action: ${action}`);
  return out.join('\n')+'\n';
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const [file,...args]=process.argv.slice(2);
    if(!file||args.length%2!==0)throw new Error('Usage: node scripts/growth-report.mjs pages.csv --period daily|weekly --from YYYY-MM-DD --to YYYY-MM-DD [--previous previous.csv] [--usage count]');
    const opts=new Map();
    for(let i=0;i<args.length;i+=2){if(!['--period','--from','--to','--previous','--usage'].includes(args[i])||opts.has(args[i]))throw new Error('Invalid or duplicate option');opts.set(args[i],args[i+1]);}
    const usage=opts.has('--usage')?Number(opts.get('--usage')):undefined;
    if(opts.has('--usage')&&!/^\d+$/.test(opts.get('--usage')))throw new Error('Invalid usage');
    console.log(growthReport(parseGrowthCounts(readFileSync(file,'utf8')),{period:opts.get('--period'),from:opts.get('--from'),to:opts.get('--to'),previous:opts.has('--previous')?parseGrowthCounts(readFileSync(opts.get('--previous'),'utf8')):undefined,usage}));
  }catch(e){console.error(e.message);process.exitCode=2;}
}
