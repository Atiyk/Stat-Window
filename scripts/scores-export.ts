/**
 * Read-only export of daily score distributions (aggregates only; no browser codes are
 * readable). Needs the store's REST URL and token in the environment, e.g. after
 * `vercel env pull .env.local` (never commit that file):
 *
 *   node --experimental-strip-types scripts/scores-export.ts --from 2026-11-18 --to 2026-11-30 [--season beta] [--env production] [--json]
 *
 * Prints, per day: n, quartiles and mean, plus the raw 0..500 histogram with --json.
 * One HGETALL per day; a month of days costs ~30 commands of the free 500K.
 */
import { countsFromHash } from '../server/store.ts';

const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN (or KV_REST_API_TOKEN). See docs/PERCENTILES.md.');
  process.exit(1);
}
const from = arg('from', new Date().toISOString().slice(0, 10))!;
const to = arg('to', from)!;
const season = arg('season', 'beta')!;
const env = arg('env', 'production')!;
const asJson = process.argv.includes('--json');
/** A plain read command (not EVAL), so Upstash's read-only token works. */
async function hgetall(key: string): Promise<unknown[]> {
  const res = await fetch(url!, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['HGETALL', key]) });
  const body = (await res.json().catch(() => null)) as { result?: unknown[]; error?: string } | null;
  if (!res.ok || !body || body.error !== undefined) throw new Error(`store error ${res.status}`);
  return body.result ?? [];
}

const quantile = (counts: number[], n: number, q: number) => {
  let seen = 0;
  for (let s = 0; s < counts.length; s++) {
    seen += counts[s]!;
    if (seen >= q * n) return s;
  }
  return 500;
};

const rows = [];
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10);
  const flat = await hgetall(`sw:v1:${env}:${season}:${day}:dist`);
  const { counts, n } = countsFromHash(flat ?? []);
  const mean = n ? counts.reduce((a, c, s) => a + c * s, 0) / n : 0;
  rows.push({ day, season, n, p25: n ? quantile(counts, n, 0.25) : null, median: n ? quantile(counts, n, 0.5) : null, p75: n ? quantile(counts, n, 0.75) : null, mean: Number(mean.toFixed(1)), ...(asJson ? { counts } : {}) });
}
if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  console.log('day,season,n,p25,median,p75,mean');
  for (const r of rows) console.log([r.day, r.season, r.n, r.p25 ?? '', r.median ?? '', r.p75 ?? '', r.mean].join(','));
  console.log('\nn = eligible first completions from distinct browser codes (not people). Small n: report counts, not rates.');
}
