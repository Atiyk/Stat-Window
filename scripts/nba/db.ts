/**
 * Builds the NBA fact database (SQLite) from data/nba with db/migrations.
 *
 *   node --experimental-strip-types scripts/nba/db.ts [--out build/nba.sqlite] [--today YYYY-MM-DD]
 *
 * Prints row counts, integrity results and a dump hash. Building twice from the
 * same data gives the same dump hash (tests check this).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { puzzleDay } from '../../src/engine/daily.ts';
import { buildSlates, eraOf, INSPECTED_ON, loadNbaData, ROOT, serializeSlate, sha256, VERIFIED_BY, type NbaData } from './model.ts';

export const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');
export const TABLES = [
  'schema_migrations', 'sources', 'franchises', 'team_names', 'players', 'seasons', 'stat_families',
  'stat_facts', 'question_candidates', 'question_tags', 'daily_themes', 'daily_slates', 'daily_slate_questions',
] as const;

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildDatabase(data: NbaData, opts: { path?: string; today: string }): DatabaseSync {
  const db = new DatabaseSync(opts.path ?? ':memory:');
  const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const m of migrations) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(Number(m.slice(0, 3)), INSPECTED_ON);
  }
  db.exec('BEGIN');
  const ins = (table: string, row: Record<string, string | number | null>) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c] ?? null));
  };

  for (const s of data.sources)
    ins('sources', {
      id: s.id, provider: s.provider, license: s.license, upstream_origin: s.upstreamOrigin, acquisition: s.acquisition,
      attribution: s.attribution, allowed_use: s.allowedUse, review_status: s.reviewStatus, reviewed_on: s.reviewedOn,
    });
  for (const f of data.franchises) {
    ins('franchises', { id: f.id, current_name: f.currentName });
    for (const n of [f.currentName, ...f.formerNames]) ins('team_names', { franchise_id: f.id, name: n });
  }
  for (const fam of data.families) ins('stat_families', { id: fam.id, label: fam.label, first_season: fam.firstSeason });
  const players = [...new Set(data.facts.map((f) => f.player).filter((p): p is string => !!p))].sort();
  for (const p of players) ins('players', { id: slug(p), name: p });
  const seasons = [...new Set(data.facts.map((f) => f.season).filter((s): s is string => !!s))].sort();
  for (const s of seasons) {
    const start = Number(s.slice(0, 4));
    ins('seasons', { id: s, start_year: start, end_year: start + 1 });
  }

  const hostSource = new Map<string, string>();
  for (const s of data.sources) for (const h of s.hosts) hostSource.set(h, s.id);
  for (const f of data.facts) {
    const q = f.question;
    ins('stat_facts', {
      id: f.id, claim: f.claim, answer: f.answer, unit_singular: f.unit.singular, unit_plural: f.unit.plural,
      precision_step: q.step, stat_family: f.family, scope: f.scope, season_id: f.season, event_date: f.eventDate,
      franchise_id: f.franchise, player_id: f.player ? slug(f.player) : null, era: eraOf(f.season),
      source_id: hostSource.get(new URL(f.source.url).host) ?? 'unknown', source_url: f.source.url,
      source_quote: f.source.quote, derivation: f.source.derivation, as_of: f.source.asOf, verification: 'verified',
      inspected_on: INSPECTED_ON,
      dedupe_key: [f.family, f.player ?? f.franchise ?? '-', f.season ?? '-', f.eventDate ?? '-', f.answer].join('|'),
    });
    ins('question_candidates', {
      id: f.id, fact_id: f.id, prompt: q.prompt, context: q.context, reveal: q.reveal, min_value: q.min, max_value: q.max,
      step: q.step, difficulty: q.difficulty, difficulty_reason: q.difficultyReason, interest: q.ratings.interest,
      recognizability: q.ratings.recognizability, estimability: q.ratings.estimability, surprise: q.ratings.surprise,
      review_state: 'approved', reviewer: VERIFIED_BY,
    });
    const tags = new Set([eraOf(f.season), f.scope, ...(f.franchise ? [f.franchise] : [])]);
    for (const t of tags) ins('question_tags', { question_id: f.id, tag: t });
  }

  const slates = new Map(buildSlates(data).map((s) => [s.date, s]));
  for (const d of data.calendar.days) {
    ins('daily_themes', { id: d.theme.id, kind: d.theme.kind, title: d.theme.title, subtitle: d.theme.subtitle, recap: d.theme.recap });
    const slate = slates.get(d.date);
    ins('daily_slates', {
      day: d.date, theme_id: d.theme.id, ramp_note: 'easy, medium, hard, hard, expert',
      content_hash: slate ? sha256(serializeSlate(slate)) : null,
      status: d.date <= opts.today ? 'published' : 'scheduled',
    });
    d.questions.forEach((id, i) => ins('daily_slate_questions', { day: d.date, slot: i + 1, question_id: id }));
  }
  db.exec('COMMIT');
  return db;
}

/** A canonical text dump of every table, for reproducibility checks. */
export function dumpDatabase(db: DatabaseSync): string {
  return TABLES.map((t) => {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
    return `## ${t}\n${rows.map((r) => JSON.stringify(r)).join('\n')}`;
  }).join('\n');
}

export function counts(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    TABLES.map((t) => [t, Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n)]),
  );
}

export function integrity(db: DatabaseSync): string[] {
  const problems: string[] = [];
  const ok = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  if (ok.integrity_check !== 'ok') problems.push(`integrity_check: ${ok.integrity_check}`);
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) problems.push(`${fk.length} foreign key violations`);
  const unverified = db.prepare("SELECT COUNT(*) AS n FROM stat_facts WHERE verification <> 'verified'").get() as { n: number };
  if (unverified.n) problems.push(`${unverified.n} facts not verified`);
  const unknown = db.prepare("SELECT COUNT(*) AS n FROM stat_facts WHERE source_id = 'unknown'").get() as { n: number };
  if (unknown.n) problems.push(`${unknown.n} facts with no source`);
  return problems;
}

function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const out = arg('--out') ?? join(ROOT, 'build', 'nba.sqlite');
  // --today can only make the status stricter (a later date), never mark a published day as scheduled.
  const real = puzzleDay(new Date());
  const asked = arg('--today');
  const today = asked && asked > real ? asked : real;
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const db = buildDatabase(loadNbaData(), { path: out, today });
  const c = counts(db);
  for (const [t, n] of Object.entries(c)) console.log(`${t.padEnd(24)} ${n}`);
  const problems = integrity(db);
  console.log(`dump sha256 ${sha256(dumpDatabase(db))}`);
  db.close();
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  console.log(`Wrote ${out}`);
}

if (process.argv[1]?.endsWith('db.ts')) main();
