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
  return rows;
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
  console.log('\nBrowsers, not people; share attempts, not deliveries. See docs/MEASUREMENT.md.');
}
