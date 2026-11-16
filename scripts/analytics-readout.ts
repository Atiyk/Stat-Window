/**
 * Turns the Vercel Web Analytics "Pages" counts into the funnel in docs/MEASUREMENT.md.
 *
 * Input: a text or CSV file with one "path,count" (or "path<TAB>count", or
 * "path count") pair per line, e.g. copied or exported from the dashboard's Pages
 * panel for one date range. Lines that are not /e/… paths are ignored.
 *
 *   node --experimental-strip-types scripts/analytics-readout.ts pages.csv [--min 30]
 *
 * Every rate needs at least --min events in its denominator (default 30);
 * below that it prints "not enough data" instead of a percentage.
 */
import { readFileSync } from 'node:fs';

export type Counts = Map<string, number>;

export function parseCounts(text: string): Counts {
  const counts: Counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"?(\/e\/[a-z0-9/\-]+)"?\s*[,\t ]\s*"?([\d,]+)"?\s*$/i.exec(line);
    if (!m) continue;
    const n = Number(m[2]!.replace(/,/g, ''));
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + n);
  }
  return counts;
}

/** Sum of every path that starts with one of the prefixes. */
export function sum(counts: Counts, ...prefixes: string[]): number {
  let total = 0;
  for (const [path, n] of counts) if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) total += n;
  return total;
}

export type Row = { metric: string; numerator: number; denominator: number; rate: string; equation: string };

export function readout(counts: Counts, min = 30): Row[] {
  const rate = (num: number, den: number) =>
    den < min ? `not enough data (${den} < ${min})` : `${((num / den) * 100).toFixed(1)}%`;
  const row = (metric: string, equation: string, num: number, den: number): Row => ({
    metric,
    numerator: num,
    denominator: den,
    rate: rate(num, den),
    equation,
  });
  const rows: Row[] = [];
  for (const mode of ['daily', 'practice', 'challenge'] as const) {
    const start = sum(counts, `/e/start/${mode}`);
    const r1 = sum(counts, `/e/lock/${mode}/r1`);
    rows.push(row(`${mode}: first touch per start`, `first-touch/${mode} ÷ start/${mode}`, sum(counts, `/e/first-touch/${mode}`), start));
    rows.push(row(`${mode}: round 1 locked per start`, `lock/${mode}/r1/* ÷ start/${mode}`, r1, start));
    rows.push(row(`${mode}: finished all five per round 1 lock`, `complete/${mode}/* ÷ lock/${mode}/r1/*`, sum(counts, `/e/complete/${mode}`), r1));
    for (let r = 2; r <= 5; r++) {
      rows.push(
        row(`${mode}: reached round ${r} per round ${r - 1}`, `lock/${mode}/r${r}/* ÷ lock/${mode}/r${r - 1}/*`, sum(counts, `/e/lock/${mode}/r${r}`), sum(counts, `/e/lock/${mode}/r${r - 1}`)),
      );
    }
  }
  const completes = sum(counts, '/e/complete/daily');
  const shares = sum(counts, '/e/share/daily/native', '/e/share/daily/clipboard');
  rows.push(row('daily: share attempts per finished game', 'share/daily/{native,clipboard} ÷ complete/daily/*', shares, completes));
  const allShares = sum(counts, '/e/share/daily/native', '/e/share/daily/clipboard', '/e/share/practice/native', '/e/share/practice/clipboard', '/e/share/challenge/native', '/e/share/challenge/clipboard');
  rows.push(row('challenge starts per share attempt', 'start/challenge ÷ share/*/{native,clipboard}', sum(counts, '/e/start/challenge'), allShares));
  const opens = sum(counts, '/e/challenge-open/today', '/e/challenge-open/past');
  rows.push(row('challenge links that opened a playable day', 'challenge-open/{today,past}/* ÷ challenge-open/*', opens, sum(counts, '/e/challenge-open')));
  const fresh = sum(counts, '/e/visit/new');
  let day1 = 0;
  let day7 = 0;
  for (const [path, n] of counts) {
    if (path.startsWith('/e/visit/return/') && path.endsWith('/day1')) day1 += n;
    if (path.startsWith('/e/visit/return/') && path.endsWith('/day7')) day7 += n;
  }
  rows.push(row('next-day return (approx.)', 'visit/return/*/day1 ÷ visit/new (same range; see bias notes)', day1, fresh));
  rows.push(row('day-7 return (approx.)', 'visit/return/*/day7 ÷ visit/new (same range; see bias notes)', day7, fresh));

  // Survival (docs/SURVIVAL.md). Every start has exactly one source.
  const svStarts = sum(counts, '/e/survival/start');
  const svFirst = sum(counts, '/e/survival/start/cta', '/e/survival/start/link');
  rows.push(row('survival: starts from the results button per finished daily', 'survival/start/cta ÷ complete/daily/*', sum(counts, '/e/survival/start/cta'), completes));
  rows.push(row('survival: deliberate "Run it again" per first start', 'survival/start/again ÷ survival/start/{cta,link}', sum(counts, '/e/survival/start/again'), svFirst));
  for (const r of [5, 10, 15]) rows.push(row(`survival: survived round ${r} per start`, `survival/reach/r${r} ÷ survival/start/*`, sum(counts, `/e/survival/reach/r${r}`), svStarts));
  rows.push(row('survival: wins per start', 'survival/win ÷ survival/start/*', sum(counts, '/e/survival/win'), svStarts));
  const ends = sum(counts, '/e/survival/end');
  for (const band of ['r1-4', 'r5-8', 'r9-12', 'r13-16', 'r17-20']) {
    rows.push(row(`survival: runs ending in rounds ${band.slice(1)}`, `survival/end/${band}/* ÷ survival/end/*`, sum(counts, `/e/survival/end/${band}`), ends));
  }
  let short = 0;
  for (const [path, n] of counts) if (path.startsWith('/e/survival/end/') && path.endsWith('/short')) short += n;
  rows.push(row('survival: ends that were inside but under the minimum', 'survival/end/*/short ÷ survival/end/*', short, ends));

  // The experiment: per arm, per exposed browser-day.
  for (const arm of ['cta', 'control'] as const) {
    const exposed = sum(counts, `/e/x/survival-cta/${arm}/exposed`);
    rows.push(row(`experiment ${arm}: browsers exposed at least once`, `x/survival-cta/${arm}/first-exposure (a count, not a rate)`, sum(counts, `/e/x/survival-cta/${arm}/first-exposure`), sum(counts, `/e/x/survival-cta/${arm}/first-exposure`)));
    rows.push(row(`experiment ${arm}: next-day daily start per exposed browser-day`, `x/survival-cta/${arm}/next-day-start ÷ …/exposed (the range's two edges roughly cancel; not exact)`, sum(counts, `/e/x/survival-cta/${arm}/next-day-start`), exposed));
    rows.push(row(`experiment ${arm}: daily share attempts per exposed browser-day (guardrail)`, `x/survival-cta/${arm}/daily-share ÷ …/exposed`, sum(counts, `/e/x/survival-cta/${arm}/daily-share`), exposed));
  }
  return rows;
}

/**
 * Difference in proportions (a − b) with a 95% normal-approximation interval.
 * Null when either arm has fewer than `min` exposures: say "not enough data".
 */
export function diffInterval(aNum: number, aDen: number, bNum: number, bDen: number, min = 200): { diff: number; lo: number; hi: number } | null {
  if (aDen < min || bDen < min) return null;
  const pa = aNum / aDen;
  const pb = bNum / bDen;
  const se = Math.sqrt((pa * (1 - pa)) / aDen + (pb * (1 - pb)) / bDen);
  const diff = pa - pb;
  return { diff, lo: diff - 1.96 * se, hi: diff + 1.96 * se };
}

if (process.argv[1]?.endsWith('analytics-readout.ts')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: analytics-readout.ts <pages.csv> [--min 30]');
    process.exit(2);
  }
  const i = process.argv.indexOf('--min');
  const min = i > -1 ? Number(process.argv[i + 1]) : 30;
  const counts = parseCounts(readFileSync(file, 'utf8'));
  if (counts.size === 0) {
    console.log('No /e/… paths found: analytics is off, or no events have arrived yet. Not enough data.');
    process.exit(0);
  }
  console.log('| Metric | Count | Of | Rate | Equation |\n|---|---|---|---|---|');
  for (const r of readout(counts, min)) console.log(`| ${r.metric} | ${r.numerator} | ${r.denominator} | ${r.rate} | ${r.equation} |`);
  const x = (arm: string, step: string) => sum(counts, `/e/x/survival-cta/${arm}/${step}`);
  const enoughBrowsers = x('cta', 'first-exposure') >= 200 && x('control', 'first-exposure') >= 200;
  const ci = enoughBrowsers ? diffInterval(x('cta', 'next-day-start'), x('cta', 'exposed'), x('control', 'next-day-start'), x('control', 'exposed')) : null;
  console.log(
    ci
      ? `\nExperiment, next-day start per exposed browser-day, cta − control: ${(ci.diff * 100).toFixed(1)} points (rough 95% interval ${(ci.lo * 100).toFixed(1)} to ${(ci.hi * 100).toFixed(1)}). It treats each browser-day as independent, so the real interval is wider; an interval near or across 0 is no evidence either way.`
      : '\nExperiment: not enough data (needs 200 browsers exposed in each arm).',
  );
  console.log('\nBrowsers, not people; share attempts, not deliveries. See docs/MEASUREMENT.md.');
}
