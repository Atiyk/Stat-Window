import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY_MS = 86_400_000;
const MONTHLY_ALLOWANCE = 50_000;
const PATH = /^\/(?:e\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;
const OFFICIAL_QUERY = "environment eq 'production' and (requestPath eq '/' or startswith(requestPath, '/e/s1/'))";
const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

function checkedCounts(entries) {
  const rows = new Map();
  let total = 0;
  for (const [path, count] of entries) {
    if (!PATH.test(path) || !Number.isSafeInteger(count) || count < 0 || rows.has(path)) {
      throw new Error('Invalid or duplicate path/count');
    }
    total += count;
    if (!Number.isSafeInteger(total)) throw new Error('Count total exceeds safe integer range');
    rows.set(path, count);
  }
  return rows;
}

export function parseGrowthCounts(input) {
  const entries = [];
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = /^(?:path|"path")\s*[,\t]\s*(?:count|views|page views|"count"|"views"|"page views")$/i;
  const row = /^(?:"(\/[^"]*)"|(\/[^,\t]*))\s*[,\t]\s*(?:"((?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+))"|([0-9]+))$/;
  let seenHeader = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (!seenHeader && !entries.length && header.test(line)) {
      seenHeader = true;
      continue;
    }
    const match = row.exec(line);
    if (!match) throw new Error(`Malformed or unsupported row ${index + 1}; use path,count with / or /e/ paths`);
    entries.push([(match[1] ?? match[2]).trim(), Number((match[3] ?? match[4]).replace(/,/g, ''))]);
  }
  if (!entries.length) throw new Error('No count rows supplied');
  return checkedCounts(entries);
}

function calendarDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Use YYYY-MM-DD dates');
  const time = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(time) || isoDay(time) !== date) throw new Error('Invalid date');
  return time;
}

function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function easternMidnight(time) {
  // For the game's reporting dates, Eastern midnight is either 04:00Z or 05:00Z.
  const fourAm = time + 4 * 3_600_000;
  return easternDate.format(fourAm) === isoDay(time) ? fourAm : fourAm + 3_600_000;
}

/** Parses the official API's production requestPath aggregate, including the connector result wrapper. */
export function parseVercelGrowthCounts(input, { from, to }) {
  const parsed = JSON.parse(input);
  const response = parsed?.result ?? parsed;
  const query = response?.query;
  const windowStart = easternMidnight(calendarDay(from));
  const nextMidnight = easternMidnight(calendarDay(to) + DAY_MS);
  if (query?.groupBy?.length !== 1 || query.groupBy[0] !== 'requestPath'
    || query.filter !== OFFICIAL_QUERY || !Array.isArray(response?.data)) {
    throw new Error('Use the production requestPath aggregate for / and /e/s1/ as documented');
  }
  if (Date.parse(query.since) !== windowStart
    || ![nextMidnight - 1, nextMidnight].includes(Date.parse(query.until))) {
    throw new Error('Provider query window does not match the declared Eastern dates');
  }
  return checkedCounts(response.data.map((entry) => {
    if (entry?.requestPath === 'Others' || typeof entry?.requestPath !== 'string') {
      throw new Error('Provider omitted individual paths; use the Pages CSV export');
    }
    if (entry.requestPath !== '/' && !entry.requestPath.startsWith('/e/s1/')) {
      throw new Error('Unexpected path outside the official provider query');
    }
    return [entry.requestPath, entry.pageviews];
  }));
}

function sum(rows, ...prefixes) {
  let total = null;
  for (const [path, count] of rows) {
    if (prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))) {
      total = (total ?? 0) + count;
    }
  }
  return total;
}

function value(count) {
  return count === null ? 'not supplied / no matching row' : String(count);
}

function aggregateRatio(numerator, denominator, inconsistent) {
  if (numerator === null || denominator === null) return 'unavailable';
  if (numerator > denominator) return inconsistent;
  if (denominator < 30) return 'insufficient denominator (<30)';
  return `${(100 * numerator / denominator).toFixed(0)}% (aggregate, not joined)`;
}

function readQuestions(count) {
  const rows = [];
  let previousLocks = count('sample/start/daily');
  for (let round = 1; round <= 5; round++) {
    const path = 'sample/lock/daily/r' + round;
    const hits = count(path + '/hit');
    const misses = count(path + '/miss');
    const locks = hits === null || misses === null ? null : hits + misses;
    const progress = aggregateRatio(locks, previousLocks, 'inconsistent counts (locks exceed prior step)');
    if (hits !== null || misses !== null) rows.push(`Q${round} ${value(misses)} miss / ${value(hits)} hit, reached from prior step ${progress}`);
    previousLocks = locks;
  }
  return rows.join('; ') || 'unavailable';
}

export function growthReport(rows, { from, to, period, previous, previousFrom, previousTo, usage }) {
  const firstDay = calendarDay(from);
  const lastDay = calendarDay(to);
  const days = (lastDay - firstDay) / DAY_MS + 1;
  if (!['daily', 'weekly'].includes(period) || days < 1 || (period === 'daily' ? days !== 1 : days > 7)) {
    throw new Error('Daily requires one date; weekly requires 1–7 consecutive dates');
  }
  if (previous) {
    if (calendarDay(previousFrom) !== firstDay - days * DAY_MS
      || calendarDay(previousTo) !== firstDay - DAY_MS) {
      throw new Error('Previous dates must immediately precede the report window and match its length');
    }
  } else if (previousFrom !== undefined || previousTo !== undefined) {
    throw new Error('Previous dates require a previous export');
  }
  if (usage !== undefined && (!Number.isSafeInteger(usage) || usage < 0)) throw new Error('Invalid usage count');
  const count = (...paths) => sum(rows, ...paths.map(path => '/e/s1/' + path));
  const starts = count('start/daily');
  const finishes = count('complete/daily');
  const completion = aggregateRatio(finishes, starts, 'not interpretable as a completion rate (finishes exceed starts)');
  const out = [
    `# Stat Window ${period} growth report: ${from} to ${to}`,
    'Official s1 events only; root page views include beta and QA. Missing rows are not assumed to be zero.',
    '',
    `Game-root page views (not unique visits): ${value(rows.get('/') ?? null)}`,
    `New browser events: ${value(count('visit/new'))} | returning browser-day events: ${value(count('visit/return'))}`,
    `Daily starts: ${value(starts)} | finishes: ${value(finishes)} | aggregate finish ratio: ${completion}`,
  ];
  if (previous) {
    const prior = sum(previous, '/e/s1/start/daily');
    const delta = prior === null || starts === null ? 'unavailable' : starts - prior;
    out.push(`Prior period (${previousFrom} to ${previousTo}): ${value(prior)} starts; change: ${delta}`);
  } else {
    out.push('Trend: unavailable (no preceding equal-length export).');
  }
  const methods = ['native', 'clipboard', 'native-image', 'image-saved', 'cancelled', 'failed'];
  for (const kind of ['share/daily', 'weekly/share']) {
    out.push(`${kind}: ${methods.map(method => method + ' ' + value(count(kind + '/' + method))).join(' | ')}`);
  }
  out.push(`Challenge: playable arrivals ${value(count('challenge-open/today', 'challenge-open/past'))}; starts ${value(count('start/challenge'))}; finishes ${value(count('complete/challenge'))} (not joined recipients).`);
  const channels = ['x', 'threads', 'reddit', 'playlin', 'alldle', 'directory', 'email', 'creator', 'groupchat', 'embed', 'search', 'video', 'guide', 'launch'];
  const referral = channels.map(channel => {
    const counts = ['landing', 'start', 'complete'].map(step => count('referral/' + channel + '/' + step));
    return counts.every(total => total === null) ? null : channel + ' ' + counts.map(value).join('/');
  }).filter(Boolean);
  out.push(`Referral landing / start / complete: ${referral.join('; ') || 'unavailable'} (aggregate events, not unique players).`);
  const returns = age => count(...['1', '2-6', '7plus'].map(gap => `visit/return/gap-${gap}/day${age}`));
  out.push(`Return indicators: D1 ${value(returns(1))}; D7 ${value(returns(7))} (event counts only; no day-aligned cohort denominator). Weekly opens: ${value(count('weekly/open'))}.`);
  out.push(`Sampled question signals (~10%): ${readQuestions(count)}.`);
  const gameFailures = count('failure/game');
  const capacity = usage === undefined
    ? 'unavailable (enter provider usage, not export totals)'
    : `${usage}/${MONTHLY_ALLOWANCE} (${Math.round(usage / MONTHLY_ALLOWANCE * 100)}%)`;
  out.push(`Game failures: ${value(gameFailures)}; comparison failures: ${value(count('failure/comparison'))}. Team monthly analytics usage: ${capacity}.`);
  out.push('Cautions: browser events ≠ people; share outcomes ≠ delivery; same-period counts are not individually linked. Export lag, missing rows, blocked storage and opt-out may bias results.');
  if (gameFailures > 0) out.push('Next action: Investigate game failures before expanding acquisition.');
  else if (usage >= MONTHLY_ALLOWANCE * 0.75) out.push('Next action: Export the baseline and review free-tier headroom.');
  else if (starts !== null && finishes !== null && finishes > starts) out.push('Next action: Check reporting windows and delayed completions before interpreting the ratio.');
  else if (starts === null || finishes === null || starts < 30) out.push('Next action: Collect a complete baseline before interpreting conversion.');
  else if (finishes / starts < 0.75) out.push('Next action: Inspect sampled progression and the first-round experience.');
  else out.push('Next action: Review the most active referral channels and keep the launch baseline stable.');
  return out.join('\n') + '\n';
}

function readCounts(file, dates) {
  const input = readFileSync(file, 'utf8');
  return file.endsWith('.json') ? parseVercelGrowthCounts(input, dates) : parseGrowthCounts(input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, ...args] = process.argv.slice(2);
    if (!file || args.length % 2 !== 0) {
      throw new Error('Usage: node scripts/growth-report.mjs <pages.csv|analytics.json> --period daily|weekly --from YYYY-MM-DD --to YYYY-MM-DD [--previous file --previous-from YYYY-MM-DD --previous-to YYYY-MM-DD] [--usage count]');
    }
    const opts = new Map();
    const accepted = new Set(['--period', '--from', '--to', '--previous', '--previous-from', '--previous-to', '--usage']);
    for (let i = 0; i < args.length; i += 2) {
      if (!accepted.has(args[i]) || opts.has(args[i])) throw new Error('Invalid or duplicate option');
      opts.set(args[i], args[i + 1]);
    }
    const usageText = opts.get('--usage');
    if (usageText !== undefined && !/^\d+$/.test(usageText)) throw new Error('Invalid usage count');
    const from = opts.get('--from');
    const to = opts.get('--to');
    const previousFrom = opts.get('--previous-from');
    const previousTo = opts.get('--previous-to');
    const previousFile = opts.get('--previous');
    const previous = previousFile ? readCounts(previousFile, { from: previousFrom, to: previousTo }) : undefined;
    process.stdout.write(growthReport(readCounts(file, { from, to }), {
      period: opts.get('--period'), from, to, previous, previousFrom, previousTo,
      usage: usageText === undefined ? undefined : Number(usageText),
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
