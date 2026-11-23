/**
 * NBA fact database: types, loading, validation and slate generation.
 *
 * The editorial source of truth is data/nba/*.json. From it we build
 *   - an SQLite database (scripts/nba-db.ts), and
 *   - the playable day files in content/days (scripts/nba-publish.ts).
 * Everything here is pure and deterministic so tests can prove the build is
 * reproducible.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerSpellings, type Question, type Slate } from '../../src/content/schema.ts';
import { addDays } from '../../src/engine/daily.ts';
import { potentialPoints } from '../../src/engine/scoring.ts';

export const ROOT = join(import.meta.dirname, '..', '..');
export const DATA_DIR = join(ROOT, 'data', 'nba');

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** Slot 1..5 of every NBA day. */
export const LADDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'hard', 'expert'];

export const SCOPES = [
  'regular-season', 'playoffs', 'finals', 'all-star', 'career', 'franchise',
  'game-rules', 'draft', 'in-season-tournament', 'combined',
] as const;
export const THEME_KINDS = ['team-season', 'franchise', 'era', 'story', 'mixed'] as const;

export const MIN_FACTS = 250;
export const MIN_DAYS = 50;
export const MIN_THEMED_DAYS = 30;
export const VERIFIED_BY = 'Stat Window editorial';
export const SOURCE_LABEL = 'Wikipedia contributors (CC BY-SA 4.0)';

export type Ratings = { interest: number; recognizability: number; estimability: number; surprise: number };

export type Fact = {
  id: string;
  family: string;
  scope: (typeof SCOPES)[number];
  season: string | null;
  eventDate: string | null;
  franchise: string | null;
  player: string | null;
  answer: number;
  unit: { singular: string; plural: string };
  claim: string;
  /** Individual verification date for later source-checked additions. */
  verifiedOn?: string;
  source: { url: string; quote: string; derivation: string | null; asOf: string | null };
  question: {
    prompt: string;
    context: string;
    reveal: string;
    min: number;
    max: number;
    step: number;
    difficulty: Difficulty;
    difficultyReason: string;
    ratings: Ratings;
    funFacts?: Question['funFacts'];
  };
};

export type Theme = { id: string; kind: (typeof THEME_KINDS)[number]; title: string; subtitle: string; recap: string };
export type CalendarDay = { date: string; theme: Theme; questions: string[] };
export type Calendar = { cutover: string; days: CalendarDay[]; reserve: string[]; reserveNotBefore?: Record<string, string> };
export type Family = { id: string; label: string; firstSeason: string | null; simpleScoringAverage: boolean };
export type Franchise = { id: string; currentName: string; formerNames: string[] };
export type Source = {
  id: string; provider: string; hosts: string[]; license: string; upstreamOrigin: string; acquisition: string;
  attribution: string; allowedUse: string; reviewStatus: 'approved' | 'reference-only' | 'rejected'; reviewedOn: string;
};
export type Rejected = { claim: string; reason: string; detail: string };

export type NbaData = {
  facts: Fact[];
  calendar: Calendar;
  families: Family[];
  franchises: Franchise[];
  sources: Source[];
  rejected: Rejected[];
};

/** Date every fact in this release was inspected against its live source page. */
export const INSPECTED_ON = '2026-11-16';

const read = <T>(name: string, dir = DATA_DIR): T => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;

export function loadNbaData(dir = DATA_DIR): NbaData {
  return {
    facts: read<Fact[]>('facts.json', dir),
    calendar: read<Calendar>('calendar.json', dir),
    families: read<Family[]>('families.json', dir),
    franchises: read<Franchise[]>('franchises.json', dir),
    sources: read<Source[]>('sources.json', dir),
    rejected: read<Rejected[]>('rejected.json', dir),
  };
}

// ---------------------------------------------------------------------------
// Small helpers

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SEASON = /^(\d{4})-(\d{2})$/;

export function seasonStart(season: string): number {
  const m = SEASON.exec(season);
  if (!m) throw new Error(`Bad season ${season}`);
  return Number(m[1]);
}

/** '1995-96' is valid; '1995-97' and '1999-01' are not; '1999-00' is. */
export function isValidSeason(season: string): boolean {
  const m = SEASON.exec(season);
  if (!m) return false;
  const start = Number(m[1]);
  return (start + 1) % 100 === Number(m[2]) && start >= 1946 && start <= 2026;
}

export function isValidDate(day: string): boolean {
  if (!ISO.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** A season runs from August of its start year to October of its end year (the 2020 bubble ended in October). */
export function dateInSeason(day: string, season: string): boolean {
  const start = seasonStart(season);
  return day >= `${start}-08-01` && day <= `${start + 1}-10-31`;
}

export function eraOf(season: string | null): string {
  if (!season) return 'timeless';
  const y = seasonStart(season);
  return `${Math.floor(y / 10) * 10}s`;
}

const hostOf = (url: string) => new URL(url).host;

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2));
}

export function jaccard(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** True when `text` shows the answer as a standalone number (so the prompt would give it away). */
export function leaksAnswer(text: string, answer: number, step: number): boolean {
  return answerSpellings(answer, step).some((s) => {
    if (/^[a-z]+$/.test(s)) return false; // number words like "seven" read naturally in prose; only check digits
    const re = new RegExp(`(^|[^0-9.,])${s.replace(/[.,]/g, (c) => `\\${c}`)}(?![0-9]|[.,][0-9])`);
    return re.test(text);
  });
}

/** Where the answer sits in its scale, 0 at min and 1 at max. */
export const position = (f: Fact) => (f.answer - f.question.min) / (f.question.max - f.question.min);

/** Points a player would earn with the tightest window centred on the middle of the scale that still catches the answer. */
export function midpointPoints(f: Fact): number {
  const { min, max, step } = f.question;
  const steps = Math.round((max - min) / step);
  const mid = Math.round(steps / 2);
  const a = (f.answer - min) / step;
  const half = Math.max(1, Math.ceil(Math.abs(a - mid)));
  const lo = Math.max(0, mid - half);
  const hi = Math.min(steps, mid + half);
  const fix = (n: number) => Number((min + n * step).toFixed(10));
  return potentialPoints({ min, max, step }, { lo: fix(lo), hi: fix(hi) });
}

// ---------------------------------------------------------------------------
// Validation

export type Report = { errors: string[]; warnings: string[]; stats: Record<string, unknown> };

const AS_OF_WORDS = /\b(still|current|currently|remains|as of|to date|ever since)\b/i;
/** Present-tense record claims in the question text itself. */
const STANDING_CLAIM = /\b(holds|still|remains|currently|to date)\b|\bis the (?:\w+ )*?record\b/i;
const BANNED_HOSTS = /(^|\.)(basketball-reference\.com|sports-reference\.com|nba\.com|kaggle\.com|githubusercontent\.com|github\.com)$/;

export function validateNba(data: NbaData): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { facts, calendar, families, franchises, sources } = data;
  const famById = new Map(families.map((f) => [f.id, f]));
  const frIds = new Set(franchises.map((f) => f.id));
  const approvedHosts = new Map<string, Source>();
  for (const s of sources) if (s.reviewStatus === 'approved') for (const h of s.hosts) approvedHosts.set(h, s);
  const byId = new Map<string, Fact>();

  // ---- facts -------------------------------------------------------------
  for (const f of facts) {
    const at = (m: string) => errors.push(`${f.id}: ${m}`);
    if (byId.has(f.id)) at('duplicate fact id');
    byId.set(f.id, f);
    if (!/^nba-[a-z0-9-]+$/.test(f.id)) at('id must be nba-<lowercase-dashes>');
    if (!(SCOPES as readonly string[]).includes(f.scope)) at(`unknown scope ${f.scope}`);
    const fam = famById.get(f.family);
    if (!fam) at(`unknown stat family ${f.family}`);

    // season and dates
    if (f.season === null) {
      if (f.scope !== 'game-rules') at('missing season (only game-rules facts may omit it)');
    } else if (!isValidSeason(f.season)) at(`invalid season ${f.season}`);
    else {
      if (fam?.firstSeason && seasonStart(f.season) < seasonStart(fam.firstSeason))
        at(`${f.family} was not officially recorded until ${fam.firstSeason}, but the fact is from ${f.season}`);
      if (f.eventDate && !dateInSeason(f.eventDate, f.season)) at(`event date ${f.eventDate} is outside season ${f.season}`);
    }
    if (f.eventDate !== null && !isValidDate(f.eventDate)) at(`invalid event date ${f.eventDate}`);
    if (f.eventDate && f.eventDate > INSPECTED_ON) at('event date is in the future');
    if (f.franchise !== null && !frIds.has(f.franchise)) at(`unknown franchise ${f.franchise}`);

    // value, units, provenance
    if (!Number.isFinite(f.answer)) at('answer is not a number');
    if (!f.unit.singular.trim() || !f.unit.plural.trim()) at('missing unit');
    if (!f.claim.trim()) at('missing claim');
    if (f.verifiedOn && !isValidDate(f.verifiedOn)) at('invalid source verification date');
    let url: URL | undefined;
    try {
      url = new URL(f.source.url);
    } catch {
      at('source URL does not parse');
    }
    if (url) {
      if (url.protocol !== 'https:') at('source must be https');
      if (BANNED_HOSTS.test(url.host)) at(`source host ${url.host} is excluded by the data-rights register`);
      else if (!approvedHosts.has(url.host)) at(`source host ${url.host} has no approved entry in data/nba/sources.json`);
    }
    const quote = f.source.quote;
    if (quote.length < 3 || quote.length > 160) at('source quote must be 3–160 characters');
    const q = f.question;
    if (q.funFacts) {
      if (q.funFacts.length !== 3) at('fun facts must have exactly three variants');
      const unique = new Set(q.funFacts.map((v) => v.text.trim().toLowerCase()));
      if (unique.size !== q.funFacts.length) at('fun facts must be distinct');
      for (const [index, entry] of q.funFacts.entries()) {
        try {
          const host = new URL(entry.source.url).host;
          if (BANNED_HOSTS.test(host) || !approvedHosts.has(host))
            at(`fun fact ${index + 1} uses an unapproved source: ${host}`);
        } catch {
          at(`fun fact ${index + 1} has an invalid URL`);
        }
        if (!entry.source.quote || entry.source.quote.length > 160)
          at(`fun fact ${index + 1} lacks short supporting evidence`);
      }
    }
    const hasFigure = answerSpellings(f.answer, q.step).some((s) => quote.toLowerCase().includes(s.toLowerCase()));
    if (!hasFigure && !f.source.derivation) at('source quote must contain the answer, or give a derivation');
    if (AS_OF_WORDS.test(quote) && !f.source.asOf) at('quote describes a standing record ("still", "remains"…) but has no asOf date');
    const asked = `${f.question.prompt} ${f.question.context} ${f.question.reveal}`;
    if (STANDING_CLAIM.test(asked) && !f.source.asOf) at('question presents a record as standing today ("holds", "is the record"…) but has no asOf date');

    // the question
    if (q.prompt.length < 10 || q.prompt.length > 140) at('prompt must be 10–140 characters');
    if (q.context.length < 3 || q.context.length > 80) at('context must be 3–80 characters');
    if (q.reveal.length < 3 || q.reveal.length > 140) at('reveal must be 3–140 characters');
    if (!(DIFFICULTIES as readonly string[]).includes(q.difficulty)) at(`missing or unknown difficulty ${q.difficulty}`);
    if (!q.difficultyReason?.trim()) at('missing difficulty rationale');
    for (const [k, v] of Object.entries(q.ratings ?? {}))
      if (!Number.isInteger(v) || v < 1 || v > 5) at(`rating ${k} must be 1–5`);
    if (Object.keys(q.ratings ?? {}).length !== 4) at('needs four editorial ratings');
    if (!(q.step > 0)) at('step must be positive');
    if (!(q.min < f.answer && f.answer < q.max)) at(`answer ${f.answer} must sit strictly inside ${q.min}–${q.max}`);
    const steps = (q.max - q.min) / q.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) at('range must be a whole number of steps');
    if (Math.round(steps) < 5 || Math.round(steps) > 400) at(`range has ${Math.round(steps)} steps; must be 5–400`);
    const p = position(f);
    if (p < 0.08 || p > 0.92) at(`answer sits at ${(p * 100).toFixed(0)}% of the scale; keep it away from the edges`);
    if (midpointPoints(f) > 90) at('a window centred on the scale catches the answer for more than 90 points; move the range');
    if (leaksAnswer(q.prompt, f.answer, q.step) || leaksAnswer(q.context, f.answer, q.step))
      at('prompt or context shows the answer');
  }

  // ---- duplicates and near-duplicates -------------------------------------
  const seenKey = new Map<string, string>();
  const seenPrompt = new Map<string, string>();
  for (const f of facts) {
    const key = [f.family, f.answer, f.season, f.eventDate, f.franchise, f.player].join('|');
    const k2 = seenKey.get(key);
    if (k2) errors.push(`${f.id}: same fact as ${k2}`);
    seenKey.set(key, f.id);
    const np = f.question.prompt.toLowerCase().replace(/\W+/g, ' ').trim();
    const p2 = seenPrompt.get(np);
    if (p2) errors.push(`${f.id}: same prompt as ${p2}`);
    seenPrompt.set(np, f.id);
  }
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i]!;
      const b = facts[j]!;
      if (a.source.quote === b.source.quote && a.answer === b.answer)
        errors.push(`${b.id}: same quote and answer as ${a.id}`);
      if (jaccard(a.question.prompt, b.question.prompt) >= 0.8)
        errors.push(`${b.id}: prompt is a near-duplicate of ${a.id}`);
      if (a.eventDate && a.eventDate === b.eventDate && a.player && a.player === b.player && a.family === b.family)
        errors.push(`${b.id}: same player, game and stat as ${a.id}`);
    }
  }

  // ---- calendar ------------------------------------------------------------
  const days = [...calendar.days].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < MIN_DAYS) errors.push(`calendar has ${days.length} days; need at least ${MIN_DAYS}`);
  if (days[0]?.date !== calendar.cutover) errors.push(`calendar must start on the cutover date ${calendar.cutover}`);
  const used = new Map<string, string>();
  const themeIds = new Set<string>();
  days.forEach((d, i) => {
    const at = (m: string) => errors.push(`${d.date}: ${m}`);
    if (!isValidDate(d.date)) at('invalid date');
    const prev = days[i - 1];
    if (prev && addDays(prev.date, 1) !== d.date) at(`does not follow ${prev.date}`);
    const t = d.theme;
    if (!t || !t.title?.trim() || !t.subtitle?.trim() || !t.recap?.trim()) at('empty theme title, subtitle or recap');
    else {
      if (t.title.length > 40) at('theme title over 40 characters');
      if (t.subtitle.length > 60) at('theme subtitle over 60 characters');
      if (t.recap.length > 220) at('theme recap over 220 characters');
      if (!(THEME_KINDS as readonly string[]).includes(t.kind)) at(`unknown theme kind ${t.kind}`);
      for (const id of d.questions) {
        const f = byId.get(id);
        if (f && (leaksAnswer(t.title, f.answer, f.question.step) || leaksAnswer(t.subtitle, f.answer, f.question.step)))
          at(`theme title or subtitle shows the answer to ${id}`);
      }
      if (themeIds.has(t.id)) at(`theme ${t.id} is used twice`);
      themeIds.add(t.id);
    }
    if (d.questions.length !== 5) at(`has ${d.questions.length} questions; need 5`);
    if (new Set(d.questions).size !== d.questions.length) at('repeats a question');
    const fs: Fact[] = [];
    d.questions.forEach((id, slot) => {
      const f = byId.get(id);
      if (!f) return at(`unknown question ${id}`);
      fs.push(f);
      const prevUse = used.get(id);
      if (prevUse) at(`${id} already used on ${prevUse}`);
      used.set(id, d.date);
      if (f.question.difficulty !== LADDER[slot])
        at(`slot ${slot + 1} must be ${LADDER[slot]}, ${id} is ${f.question.difficulty}`);
    });
    // V3 future NBA mix: reject mechanically repetitive slates before they are published.
    // Published puzzles before the cutover keep their existing immutable fingerprints.
    if (d.date >= '2026-11-23' && fs.length === 5) {
      const families = new Set(fs.map((f) => f.family));
      const subjects = new Set(fs.map((f) => f.player ?? f.franchise ?? f.family));
      if (families.size < 3) at(`only ${families.size} stat families (mixed slate needs 3)`);
      if (subjects.size < 3) at(`only ${subjects.size} subjects (mixed slate needs 3)`);
      const franchises = new Map<string, number>();
      const players = new Map<string, number>();
      for (const f of fs) {
        if (f.franchise) franchises.set(f.franchise, (franchises.get(f.franchise) ?? 0) + 1);
        if (f.player) players.set(f.player, (players.get(f.player) ?? 0) + 1);
      }
      for (const [franchise, n] of franchises) if (n > 2) at(`${n} questions about ${franchise} (max 2)`);
      for (const [player, n] of players) if (n > 2) at(`${n} questions about ${player} (max 2)`);
      for (let slot = 1; slot < fs.length; slot++) {
        if (fs[slot]!.family === fs[slot - 1]!.family)
          at(`adjacent questions ${slot} and ${slot + 1} repeat the same stat family`);
      }
      const opening = fs[0]!.question.ratings;
      const engaging = opening.recognizability >= 4 && opening.interest >= 4 && opening.estimability >= 3;
      // Every future mixed-slate opener must pass the same hard editorial gate,
      // including late-January dates. Do not inflate ratings or demote failures
      // to warnings; replace weak hooks with genuinely stronger sourced facts.
      if (!engaging) at('Q1 is not a recognizable, interesting, estimable NBA hook');
    }
    const famCount = new Map<string, number>();
    for (const f of fs) famCount.set(f.family, (famCount.get(f.family) ?? 0) + 1);
    for (const [fam, n] of famCount) if (n > 2) at(`${n} questions from the ${fam} family (max 2)`);
    const avg = fs.filter((f) => famById.get(f.family)?.simpleScoringAverage).length;
    if (avg > 1) at(`${avg} simple scoring-average questions (max 1)`);
    for (let a = 0; a < fs.length; a++)
      for (let b = a + 1; b < fs.length; b++) {
        const x = fs[a]!;
        const y = fs[b]!;
        if (x.source.quote === y.source.quote && x.family === y.family) at(`${x.id} and ${y.id} test the same fact`);
      }
  });
  for (const id of calendar.reserve) {
    if (!byId.has(id)) errors.push(`reserve: unknown question ${id}`);
    if (used.has(id)) errors.push(`reserve: ${id} is also scheduled on ${used.get(id)}`);
  }
  // A future scheduled puzzle moved into reserve must not become playable in
  // Survival immediately. Reserve embargoes preserve the original daily
  // publication date plus one day, even after re-sequencing.
  for (const [id, notBefore] of Object.entries(calendar.reserveNotBefore ?? {})) {
    if (!calendar.reserve.includes(id)) errors.push(`reserve: embargo for non-reserve question ${id}`);
    if (!isValidDate(notBefore) || notBefore <= calendar.cutover)
      errors.push(`reserve: invalid release embargo ${id} -> ${notBefore}`);
  }
  const unplaced = facts.filter((f) => !used.has(f.id) && !calendar.reserve.includes(f.id));
  for (const f of unplaced) errors.push(`${f.id}: neither scheduled nor in reserve`);
  const themed = days.filter((d) => d.theme?.kind !== 'mixed').length;
  const mixed = days.filter((d) => d.theme?.kind === 'mixed').length;
  // V3 intentionally replaced same-team slates with five-subject mixes. Keep the
  // original 30-day editorial coverage floor, now applying it to mixed days.
  if (mixed < MIN_THEMED_DAYS) errors.push(`${mixed} mixed days; need at least ${MIN_THEMED_DAYS}`);

  // rolling 7-day editorial balance
  const primary = (d: CalendarDay): string | null => {
    const c = new Map<string, number>();
    for (const id of d.questions) {
      const fr = byId.get(id)?.franchise;
      if (fr) c.set(fr, (c.get(fr) ?? 0) + 1);
    }
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 3 ? top[0] : null;
  };
  for (let i = 0; i + 7 <= days.length; i++) {
    const win = days.slice(i, i + 7);
    const fs = win.flatMap((d) => d.questions.map((id) => byId.get(id)).filter((f): f is Fact => !!f));
    const label = `${win[0]!.date}…${win[6]!.date}`;
    const fams = new Set(fs.map((f) => f.family)).size;
    if (fams < 6) errors.push(`${label}: only ${fams} stat families in 7 days (min 6)`);
    const fr = new Map<string, number>();
    for (const f of fs) if (f.franchise) fr.set(f.franchise, (fr.get(f.franchise) ?? 0) + 1);
    for (const [k, n] of fr) if (n > 10) errors.push(`${label}: ${n} questions about ${k} in 7 days (max 10)`);
    const eras = new Set(fs.map((f) => eraOf(f.season)).filter((e) => e !== 'timeless')).size;
    if (eras < 3) errors.push(`${label}: only ${eras} eras in 7 days (min 3)`);
  }
  for (let i = 1; i < days.length; i++) {
    const a = primary(days[i - 1]!);
    const b = primary(days[i]!);
    if (a && a === b) errors.push(`${days[i]!.date}: same lead franchise (${a}) as the day before`);
  }

  // ---- counts --------------------------------------------------------------
  if (facts.length < MIN_FACTS) errors.push(`only ${facts.length} verified facts; need at least ${MIN_FACTS}`);
  const scheduled = days.reduce((n, d) => n + d.questions.length, 0);
  if (scheduled < MIN_FACTS) errors.push(`only ${scheduled} scheduled questions; need at least ${MIN_FACTS}`);

  const positions = facts.map(position);
  const middle = positions.filter((p) => Math.abs(p - 0.5) < 0.1).length / positions.length;
  if (middle > 0.35) errors.push(`${(middle * 100).toFixed(0)}% of answers sit in the middle fifth of their scales; spread them out`);

  return {
    errors,
    warnings,
    stats: {
      facts: facts.length,
      days: days.length,
      scheduled,
      reserve: calendar.reserve.length,
      themedDays: themed,
      families: new Set(facts.map((f) => f.family)).size,
      franchises: new Set(facts.map((f) => f.franchise).filter(Boolean)).size,
      middleFifthShare: Number(middle.toFixed(3)),
    },
  };
}

// ---------------------------------------------------------------------------
// Slate generation

export function questionFromFact(f: Fact): Question & { difficulty: Difficulty } {
  const q = f.question;
  return {
    id: f.id,
    sport: 'NBA',
    prompt: q.prompt,
    context: q.context,
    answer: f.answer,
    unit: { singular: f.unit.singular, plural: f.unit.plural },
    min: q.min,
    max: q.max,
    step: q.step,
    note: q.reveal,
    source: {
      name: SOURCE_LABEL,
      url: f.source.url,
      quote: f.source.quote,
      ...(f.source.derivation ? { derivation: f.source.derivation } : {}),
    },
    verified: { on: f.verifiedOn ?? INSPECTED_ON, by: VERIFIED_BY },
    difficulty: q.difficulty,
    ...(q.funFacts ? { funFacts: q.funFacts } : {}),
  };
}

export function buildSlates(data: NbaData): Slate[] {
  const byId = new Map(data.facts.map((f) => [f.id, f]));
  return data.calendar.days.map((d) => ({
    date: d.date,
    theme: { title: d.theme.title, subtitle: d.theme.subtitle, recap: d.theme.recap },
    questions: d.questions.map((id) => {
      const f = byId.get(id);
      if (!f) throw new Error(`${d.date}: unknown question ${id}`);
      return questionFromFact(f);
    }),
  }));
}

/** The exact bytes we write for a day file. */
export const serializeSlate = (s: Slate): string => `${JSON.stringify(s, null, 2)}\n`;

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

export { hostOf };
