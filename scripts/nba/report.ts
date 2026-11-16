/**
 * Writes the reviewable proof files in docs/nba/ from data/nba:
 *   questions.csv   every question with its source metadata
 *   calendar.md     the day-by-day calendar
 *   validation.md   counts, gates and editorial balance
 *
 *   node --experimental-strip-types scripts/nba/report.ts [--check]
 * --check exits 1 if the committed files are stale (tests run this too).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDatabase, counts, dumpDatabase, integrity } from './db.ts';
import { eraOf, LADDER, loadNbaData, midpointPoints, position, ROOT, sha256, validateNba, type Fact, type NbaData } from './model.ts';

export const REPORT_DIR = join(ROOT, 'docs', 'nba');
/** Reports are dated by the release, not the clock, so they are reproducible. */
const REPORT_TODAY = '2026-11-16';

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function questionsCsv(data: NbaData): string {
  const where = new Map<string, { date: string; slot: number }>();
  for (const d of data.calendar.days) d.questions.forEach((id, i) => where.set(id, { date: d.date, slot: i + 1 }));
  const head = [
    'id', 'day', 'slot', 'difficulty', 'family', 'scope', 'season', 'event_date', 'era', 'franchise', 'player',
    'answer', 'unit', 'min', 'max', 'step', 'prompt', 'context', 'reveal', 'source_url', 'source_quote', 'derivation',
    'as_of', 'interest', 'recognizability', 'estimability', 'surprise', 'difficulty_reason',
  ];
  const rows = data.facts.map((f) => {
    const w = where.get(f.id);
    const q = f.question;
    return [
      f.id, w?.date ?? 'reserve', w?.slot ?? '', q.difficulty, f.family, f.scope, f.season, f.eventDate, eraOf(f.season),
      f.franchise, f.player, f.answer, f.unit.plural, q.min, q.max, q.step, q.prompt, q.context, q.reveal, f.source.url,
      f.source.quote, f.source.derivation, f.source.asOf, q.ratings.interest, q.ratings.recognizability,
      q.ratings.estimability, q.ratings.surprise, q.difficultyReason,
    ].map(csvCell).join(',');
  });
  return `${[head.join(','), ...rows].join('\n')}\n`;
}

export function calendarMd(data: NbaData): string {
  const byId = new Map(data.facts.map((f) => [f.id, f]));
  const lines = [
    '# NBA calendar',
    '',
    `Generated from data/nba by \`npm run nba:report\`. Cutover: ${data.calendar.cutover}. Slots climb ${LADDER.join(', ')}.`,
    '',
    '| # | Date (UTC) | Kind | Theme | Questions (answer) |',
    '|---|---|---|---|---|',
  ];
  data.calendar.days.forEach((d, i) => {
    const qs = d.questions.map((id) => {
      const f = byId.get(id)!;
      return `${id.replace(/^nba-/, '')} (${f.answer})`;
    });
    lines.push(`| ${i + 1} | ${d.date} | ${d.theme.kind} | **${d.theme.title}** · ${d.theme.subtitle} | ${qs.join('; ')} |`);
  });
  lines.push('', `Reserve (${data.calendar.reserve.length}): ${data.calendar.reserve.map((r) => r.replace(/^nba-/, '')).join(', ')}`, '');
  return lines.join('\n');
}

const tally = <T extends string | number>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

export function validationMd(data: NbaData): string {
  const r = validateNba(data);
  const db = buildDatabase(data, { today: REPORT_TODAY });
  const c = counts(db);
  const problems = integrity(db);
  const dump = sha256(dumpDatabase(db));
  db.close();
  const facts = data.facts;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
  const scheduled = data.calendar.days.flatMap((d) => d.questions.map((id) => byId.get(id)!));

  // rolling windows
  const winRows: string[] = [];
  for (let i = 0; i + 7 <= data.calendar.days.length; i += 7) {
    const win = data.calendar.days.slice(i, i + 7);
    const fs = win.flatMap((d) => d.questions.map((id) => byId.get(id)!));
    const fr = tally(fs.map((f) => f.franchise ?? '—')).sort((a, b) => b[1] - a[1])[0];
    winRows.push(
      `| ${win[0]!.date} to ${win.at(-1)!.date} | ${new Set(fs.map((f) => f.family)).size} | ${new Set(fs.map((f) => eraOf(f.season))).size} | ${fr?.[0]} (${fr?.[1]}) |`,
    );
  }

  // novelty: first appearance of each player, franchise and era
  const seenP = new Set<string>();
  const seenF = new Set<string>();
  const novelty = data.calendar.days.map((d) => {
    let np = 0;
    let nf = 0;
    for (const id of d.questions) {
      const f = byId.get(id)!;
      if (f.player && !seenP.has(f.player)) (seenP.add(f.player), np++);
      if (f.franchise && !seenF.has(f.franchise)) (seenF.add(f.franchise), nf++);
    }
    return { date: d.date, np, nf };
  });
  const quiet = novelty.filter((n) => n.np === 0 && n.nf === 0).length;

  const hist = tally(facts.map((f) => Math.min(9, Math.floor(position(f) * 10))));
  const mid = facts.map(midpointPoints);

  const lines = [
    '# NBA validation report',
    '',
    'Generated by `npm run nba:report` from data/nba. Tests fail if this file is stale.',
    '',
    '## Result',
    '',
    r.errors.length ? `**${r.errors.length} errors**\n\n${r.errors.map((e) => `- ${e}`).join('\n')}` : 'All gates pass: 0 errors.',
    '',
    '## Counts',
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Verified facts (one question each) | ${facts.length} |`,
    `| Scheduled questions | ${scheduled.length} |`,
    `| Reserve questions | ${data.calendar.reserve.length} |`,
    `| Days | ${data.calendar.days.length} (${data.calendar.days[0]?.date} to ${data.calendar.days.at(-1)?.date}) |`,
    `| Themed days (not "mixed") | ${data.calendar.days.filter((d) => d.theme.kind !== 'mixed').length} |`,
    `| Stat families | ${new Set(facts.map((f) => f.family)).size} |`,
    `| Franchises | ${new Set(facts.map((f) => f.franchise).filter(Boolean)).size} |`,
    `| Players | ${new Set(facts.map((f) => f.player).filter(Boolean)).size} |`,
    `| Seasons | ${new Set(facts.map((f) => f.season).filter(Boolean)).size} |`,
    `| Rejected examples logged | ${data.rejected.length} |`,
    '',
    '## SQLite build',
    '',
    '| Table | Rows |',
    '|---|---|',
    ...Object.entries(c).map(([t, n]) => `| ${t} | ${n} |`),
    '',
    `Integrity: ${problems.length ? problems.join('; ') : 'integrity_check ok, no foreign-key violations, every fact verified and sourced'}.`,
    `Canonical dump sha256 (status as of ${REPORT_TODAY}): \`${dump}\`.`,
    '',
    '## Difficulty',
    '',
    '| Difficulty | All facts | Scheduled |',
    '|---|---|---|',
    ...['easy', 'medium', 'hard', 'expert'].map(
      (d) => `| ${d} | ${facts.filter((f) => f.question.difficulty === d).length} | ${scheduled.filter((f) => f.question.difficulty === d).length} |`,
    ),
    '',
    'Mean editorial ratings by slot (interest / recognizability / estimability / surprise):',
    '',
    ...[0, 1, 2, 3, 4].map((slot) => {
      const fs = data.calendar.days.map((d) => byId.get(d.questions[slot]!)!);
      const k = (key: keyof Fact['question']['ratings']) => mean(fs.map((f) => f.question.ratings[key]));
      return `- Slot ${slot + 1} (${LADDER[slot]}): ${k('interest')} / ${k('recognizability')} / ${k('estimability')} / ${k('surprise')}`;
    }),
    '',
    '## Range fairness',
    '',
    'Where each answer sits on its scale (0 = min, 9 = top tenth). A flat spread means centring a window is not a winning strategy.',
    '',
    '| Tenth | Questions |',
    '|---|---|',
    ...hist.map(([b, n]) => `| ${b} | ${n} |`),
    '',
    `Share of answers in the middle fifth: ${(Number(r.stats.middleFifthShare) * 100).toFixed(1)}% (gate: at most 35%).`,
    `Simulated "always centre the window" player: mean ${mean(mid)} points per question, best ${Math.max(...mid)} (gate: no question above 90).`,
    'Every answer sits strictly inside its scale and at least 8% away from either end; every scale has 5–400 whole steps.',
    '',
    '## Editorial balance, by week',
    '',
    '| Week | Stat families | Eras | Most-used franchise |',
    '|---|---|---|---|',
    ...winRows,
    '',
    'Every rolling 7-day window is also checked: at least 6 families, at least 3 eras, at most 10 questions about one franchise, and no two days in a row led by the same franchise. Each day has at most 2 questions from one family and at most 1 simple scoring average.',
    '',
    '## Novelty',
    '',
    `${seenP.size} players and ${seenF.size} franchises appear. ${quiet} of ${novelty.length} days introduce no new player or franchise.`,
    '',
    '## Eras',
    '',
    ...tally(facts.map((f) => eraOf(f.season))).map(([e, n]) => `- ${e}: ${n}`),
    '',
    '## Rejected candidates (examples)',
    '',
    ...data.rejected.map((x) => `- **${x.claim}**: ${x.reason}. ${x.detail}`),
    '',
  ];
  return lines.join('\n');
}

export function reportFiles(data = loadNbaData()): Record<string, string> {
  return {
    'questions.csv': questionsCsv(data),
    'calendar.md': calendarMd(data),
    'validation.md': validationMd(data),
  };
}

function main() {
  const check = process.argv.includes('--check');
  mkdirSync(REPORT_DIR, { recursive: true });
  let stale = 0;
  for (const [name, body] of Object.entries(reportFiles())) {
    const path = join(REPORT_DIR, name);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current === body) continue;
    if (check) {
      console.error(`error: docs/nba/${name} is stale; run npm run nba:report`);
      stale++;
    } else {
      writeFileSync(path, body);
      console.log(`wrote docs/nba/${name}`);
    }
  }
  if (stale) process.exit(1);
  if (check) console.log('docs/nba is up to date.');
}

if (process.argv[1]?.endsWith('report.ts')) main();
