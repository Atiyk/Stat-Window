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
export type Cohort = 'beta' | 's1' | 'qa';

export function parseCounts(text: string): Counts {
  const counts: Counts = new Map();
  let total = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!/^"?\/e\//.test(line)) continue;
    const match = /^(?:"(\/e\/[a-z0-9/-]+)"|(\/e\/[a-z0-9/-]+))\s*[,\t ]\s*(?:"(\d+(?:,\d{3})*)"|(\d+(?:,\d{3})*))$/.exec(line);
    if (!match) throw new Error(`Malformed event count at row ${index + 1}`);
    const path = match[1] ?? match[2]!;
    const count = Number((match[3] ?? match[4]!).replace(/,/g, ''));
    if (!Number.isSafeInteger(count) || counts.has(path)) throw new Error(`Invalid or duplicate event count at row ${index + 1}`);
    total += count;
    if (!Number.isSafeInteger(total)) throw new Error('Event total exceeds safe integer range');
    counts.set(path, count);
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

function forCohort(counts: Counts, cohort: Cohort): Counts {
  const prefix = `/e/${cohort}/`;
  if (cohort === 'beta') return new Map([...counts].filter(([path]) => !/^\/e\/(s1|qa)\//.test(path)));
  return new Map([...counts].filter(([path]) => path.startsWith(prefix)).map(([path, n]) => [`/e/${path.slice(prefix.length)}`, n]));
}

export function readout(raw: Counts, min = 30, cohort: Cohort = 'beta'): Row[] {
  const counts = forCohort(raw, cohort);
  const rate = (num: number, den: number) =>
    den < min ? `not enough data (${den} < ${min})` : `${((num / den) * 100).toFixed(1)}%`;
  const row = (metric: string, equation: string, num: number, den: number, bounded = false): Row => ({
    metric,
    numerator: num,
    denominator: den,
    rate: bounded && num > den ? 'data quality warning (downstream count exceeds upstream)' : rate(num, den),
    equation,
  });
  const countOnly = (metric: string, equation: string, n: number): Row => ({
    metric, equation, numerator: n, denominator: 0, rate: 'count only',
  });
  const rows: Row[] = [];
  for (const mode of ['daily', 'practice', 'challenge'] as const) {
    rows.push(row(`${mode}: finishes per start`, `complete/${mode}/* ÷ start/${mode}`, sum(counts, `/e/complete/${mode}`), sum(counts, `/e/start/${mode}`), true));
  }
  const sampled = cohort !== 'beta' || sum(counts, '/e/sample') > 0;
  if (sampled) {
    const path = '/e/sample';
    const r1 = sum(counts, `${path}/lock/daily/r1`);
    const starts = sum(counts, `${path}/start/daily`);
    rows.push(row('sampled daily: first touch per start', 'sample/first-touch/daily ÷ sample/start/daily', sum(counts, `${path}/first-touch/daily`), starts, true));
    rows.push(row('sampled daily: round 1 locked per start', 'sample/lock/daily/r1/* ÷ sample/start/daily', r1, starts, true));
    for (let r = 2; r <= 5; r++) {
      rows.push(row(`sampled daily: round ${r} lock per round ${r - 1} lock`, `sample/lock/daily/r${r}/* ÷ sample/lock/daily/r${r - 1}/*`, sum(counts, `${path}/lock/daily/r${r}`), sum(counts, `${path}/lock/daily/r${r - 1}`), true));
    }
  } else for (const mode of ['daily', 'practice', 'challenge'] as const) {
    const start = sum(counts, `/e/start/${mode}`);
    const r1 = sum(counts, `/e/lock/${mode}/r1`);
    rows.push(row(`${mode}: first touch per start`, `first-touch/${mode} ÷ start/${mode}`, sum(counts, `/e/first-touch/${mode}`), start, true));
    rows.push(row(`${mode}: round 1 locked per start`, `lock/${mode}/r1/* ÷ start/${mode}`, r1, start, true));
    rows.push(row(`${mode}: finished all five per round 1 lock`, `complete/${mode}/* ÷ lock/${mode}/r1/*`, sum(counts, `/e/complete/${mode}`), r1, true));
    for (let r = 2; r <= 5; r++) {
      rows.push(
        row(`${mode}: reached round ${r} per round ${r - 1}`, `lock/${mode}/r${r}/* ÷ lock/${mode}/r${r - 1}/*`, sum(counts, `/e/lock/${mode}/r${r}`), sum(counts, `/e/lock/${mode}/r${r - 1}`), true),
      );
    }
  }
  const completes = sum(counts, '/e/complete/daily');
  const shares = sum(counts, '/e/share/daily');
  const shareActions = sum(counts, '/e/share/daily/native', '/e/share/daily/clipboard', '/e/share/daily/native-image', '/e/share/daily/image-saved');
  rows.push(row('daily: recorded share attempts per finished game', 'share/daily/* ÷ complete/daily/*', shares, completes));
  rows.push(row('daily: successful local actions per recorded share attempt', 'share/daily/{native,clipboard,native-image,image-saved} ÷ share/daily/*', shareActions, shares, true));
  const allShares = sum(counts, '/e/share/daily/native', '/e/share/daily/clipboard', '/e/share/practice/native', '/e/share/practice/clipboard', '/e/share/challenge/native', '/e/share/challenge/clipboard');
  rows.push(row('challenge starts per copied or handed-off link', 'start/challenge ÷ share/*/{native,clipboard}', sum(counts, '/e/start/challenge'), allShares));
  const opens = sum(counts, '/e/challenge-open/today', '/e/challenge-open/past');
  rows.push(row('challenge links that opened a playable day', 'challenge-open/{today,past}/* ÷ challenge-open/*', opens, sum(counts, '/e/challenge-open'), true));
  rows.push(row('referred finishes per playable challenge arrival', 'complete/challenge/* ÷ challenge-open/{today,past}/*', sum(counts, '/e/complete/challenge'), opens));
  let day1 = 0;
  let day7 = 0;
  for (const [path, n] of counts) {
    if (path.startsWith('/e/visit/return/') && path.endsWith('/day1')) day1 += n;
    if (path.startsWith('/e/visit/return/') && path.endsWith('/day7')) day7 += n;
  }
  rows.push(countOnly('D1 return events', 'visit/return/*/day1 (no aligned acquisition cohort denominator)', day1));
  rows.push(countOnly('D7 return events', 'visit/return/*/day7 (no aligned acquisition cohort denominator)', day7));

  // Survival (docs/SURVIVAL.md). Every start has exactly one source.
  const svStarts = sum(counts, '/e/survival/start');
  const svFirst = sum(counts, '/e/survival/start/cta', '/e/survival/start/link');
  rows.push(row('survival: starts from the results button per finished daily', 'survival/start/cta ÷ complete/daily/*', sum(counts, '/e/survival/start/cta'), completes));
  rows.push(row('survival: deliberate "Run it again" per first start', 'survival/start/again ÷ survival/start/{cta,link}', sum(counts, '/e/survival/start/again'), svFirst));
  for (const r of [5, 10, 15]) rows.push(row(`survival: survived round ${r} per start`, `survival/reach/r${r} ÷ survival/start/*`, sum(counts, `/e/survival/reach/r${r}`), svStarts, true));
  rows.push(row('survival: wins per start', 'survival/win ÷ survival/start/*', sum(counts, '/e/survival/win'), svStarts, true));
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
    rows.push(countOnly(`experiment ${arm}: first exposure events`, `x/survival-cta/${arm}/first-exposure`, sum(counts, `/e/x/survival-cta/${arm}/first-exposure`)));
    rows.push(row(`experiment ${arm}: next-day daily start per exposed browser-day`, `x/survival-cta/${arm}/next-day-start ÷ …/exposed (the range's two edges roughly cancel; not exact)`, sum(counts, `/e/x/survival-cta/${arm}/next-day-start`), exposed, true));
    rows.push(row(`experiment ${arm}: daily share attempts per exposed browser-day (guardrail)`, `x/survival-cta/${arm}/daily-share ÷ …/exposed`, sum(counts, `/e/x/survival-cta/${arm}/daily-share`), exposed));
  }
  return rows;
}

/**
 * Difference in proportions (a − b) with a 95% normal-approximation interval.
 * Null for invalid counts, small samples or a boundary where the normal
 * approximation would give a misleading interval.
 */
export function diffInterval(aNum: number, aDen: number, bNum: number, bDen: number, min = 200): { diff: number; lo: number; hi: number } | null {
  if (![aNum, aDen, bNum, bDen, min].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  if (min < 1 || aDen < min || bDen < min || aNum === 0 || bNum === 0 || aNum >= aDen || bNum >= bDen) return null;
  const pa = aNum / aDen;
  const pb = bNum / bDen;
  const se = Math.sqrt((pa * (1 - pa)) / aDen + (pb * (1 - pb)) / bDen);
  const diff = pa - pb;
  return { diff, lo: diff - 1.96 * se, hi: diff + 1.96 * se };
}

if (process.argv[1]?.endsWith('analytics-readout.ts')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: analytics-readout.ts <pages.csv> [--cohort beta|s1|qa] [--min 30]');
    process.exit(2);
  }
  const i = process.argv.indexOf('--min');
  const min = i > -1 ? Number(process.argv[i + 1]) : 30;
  if (!Number.isSafeInteger(min) || min < 1) {
    console.error('--min must be a positive whole number');
    process.exit(2);
  }
  const j = process.argv.indexOf('--cohort');
  const cohort = j > -1 ? process.argv[j + 1] : 'beta';
  if (cohort !== 'beta' && cohort !== 's1' && cohort !== 'qa') {
    console.error('--cohort must be beta, s1 or qa');
    process.exit(2);
  }
  let parsed: Counts;
  try {
    parsed = parseCounts(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const counts = forCohort(parsed, cohort);
  if (counts.size === 0) {
    console.log('No /e/… paths found: analytics is off, or no events have arrived yet. Not enough data.');
    process.exit(0);
  }
  console.log('| Metric | Count | Of | Rate | Equation |\n|---|---|---|---|---|');
  for (const r of readout(parsed, min, cohort)) console.log(`| ${r.metric} | ${r.numerator} | ${r.denominator} | ${r.rate} | ${r.equation} |`);
  const x = (arm: string, step: string) => sum(counts, `/e/x/survival-cta/${arm}/${step}`);
  const enoughBrowsers = x('cta', 'first-exposure') >= 200 && x('control', 'first-exposure') >= 200;
  const ctaStarts = x('cta', 'next-day-start');
  const controlStarts = x('control', 'next-day-start');
  const ctaExposed = x('cta', 'exposed');
  const controlExposed = x('control', 'exposed');
  const impossible = ctaStarts > ctaExposed || controlStarts > controlExposed;
  const ci = enoughBrowsers ? diffInterval(ctaStarts, ctaExposed, controlStarts, controlExposed) : null;
  console.log(
    ci
      ? `\nExperiment, next-day start per exposed browser-day, cta − control: ${(ci.diff * 100).toFixed(1)} points (rough 95% interval ${(ci.lo * 100).toFixed(1)} to ${(ci.hi * 100).toFixed(1)}). It treats each browser-day as independent, so the real interval is wider; an interval near or across 0 is no evidence either way.`
      : impossible
        ? '\nExperiment data quality warning: next-day starts exceed exposures. Check reporting dates and deduplication.'
        : '\nExperiment: insufficient data for an interval. Each arm needs 200 first exposures, 200 total exposure events and next-day start counts between zero and total exposures.',
  );
  console.log('\nBrowsers, not people; share attempts, not deliveries. See docs/MEASUREMENT.md.');
}
