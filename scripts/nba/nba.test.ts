import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDatabase, counts, dumpDatabase, integrity } from './db.ts';
import {
  buildSlates, loadNbaData, MIN_DAYS, MIN_FACTS, ROOT, serializeSlate, sha256, validateNba, type Fact, type NbaData,
} from './model.ts';
import { checkLock as checkPublishedLock, nextLock, parseSlate, scoringFingerprint } from '../../src/content/schema.ts';
import { DAYS_DIR, laterDay, planPublish, readLock } from './publish.ts';
import { reschedule } from './reschedule.ts';
import { NBA_CUTOVER } from '../../src/content/cutover.ts';
import { reportFiles } from './report.ts';

const real = loadNbaData();
const clone = (): NbaData => structuredClone(real);
const errorsOf = (d: NbaData) => validateNba(d).errors;
const fact = (d: NbaData, id: string) => d.facts.find((f) => f.id === id)!;
const firstOf = (d: NbaData): Fact => fact(d, d.calendar.days[0]!.questions[0]!);

describe('NBA database: the real data', () => {
  const report = validateNba(real);
  it('passes every gate', () => {
    expect(report.errors).toEqual([]);
  });
  it(`has at least ${MIN_FACTS} verified facts and ${MIN_DAYS} days`, () => {
    expect(real.facts.length).toBeGreaterThanOrEqual(MIN_FACTS);
    expect(real.calendar.days.length).toBeGreaterThanOrEqual(MIN_DAYS);
    expect(real.calendar.days.reduce((n, d) => n + d.questions.length, 0)).toBeGreaterThanOrEqual(MIN_FACTS);
  });
  it('generates slates that pass the game schema and are NBA-only', () => {
    for (const s of buildSlates(real)) {
      const parsed = parseSlate(s);
      expect(parsed.theme?.title).toBeTruthy();
      for (const q of parsed.questions) {
        expect(q.sport).toBe('NBA');
        expect(q.difficulty).toBeTruthy();
        expect(new URL(q.source.url).host).toBe('en.wikipedia.org');
      }
    }
  });
  it('uses only approved sources', () => {
    const approved = new Set(real.sources.filter((s) => s.reviewStatus === 'approved').flatMap((s) => s.hosts));
    for (const f of real.facts) expect(approved.has(new URL(f.source.url).host)).toBe(true);
  });
});

describe('NBA database: each gate catches what it should', () => {
  const cases: [string, (d: NbaData) => void, RegExp][] = [
    ['fewer than 250 facts', (d) => { d.facts = d.facts.slice(0, 200); }, /verified facts|neither scheduled|unknown question/],
    ['fewer than 50 days', (d) => { d.calendar.days = d.calendar.days.slice(0, 49); }, /need at least 50/],
    ['a day with four questions', (d) => { d.calendar.days[3]!.questions.pop(); }, /has 4 questions/],
    ['the same question on two days', (d) => { d.calendar.days[4]!.questions[0] = d.calendar.days[3]!.questions[0]!; }, /already used on/],
    ['a gap in dates', (d) => { d.calendar.days[10]!.date = '2027-02-01'; }, /does not follow/],
    ['days out of order', (d) => { const [a, b] = [d.calendar.days[1]!, d.calendar.days[2]!]; [a.date, b.date] = [b.date, a.date]; [a.questions, b.questions] = [b.questions, a.questions]; d.calendar.days.reverse(); }, /^$/],
    ['an empty theme', (d) => { d.calendar.days[0]!.theme.title = ' '; }, /empty theme/],
    ['a non-Wikipedia source', (d) => { firstOf(d).source.url = 'https://www.basketball-reference.com/x.html'; }, /excluded by the data-rights register/],
    ['an unregistered source', (d) => { firstOf(d).source.url = 'https://example.org/x'; }, /no approved entry/],
    ['a quote that does not show the number', (d) => { firstOf(d).source.quote = 'a famous night in Hershey'; }, /must contain the answer/],
    ['a missing unit', (d) => { firstOf(d).unit.plural = ''; }, /missing unit/],
    ['a missing season', (d) => { firstOf(d).season = null; }, /missing season/],
    ['an impossible season', (d) => { firstOf(d).season = '1995-97'; }, /invalid season/],
    ['a date outside its season', (d) => { firstOf(d).eventDate = '1970-01-01'; }, /outside season/],
    ['an answer on the boundary', (d) => { const f = firstOf(d); f.question.max = f.answer; }, /strictly inside/],
    ['a step that does not divide the range', (d) => { firstOf(d).question.step = 7; }, /whole number of steps/],
    ['too many steps', (d) => { const f = firstOf(d); f.question.step = 0.01; }, /must be 5–400/],
    ['a missing difficulty', (d) => { (firstOf(d).question as { difficulty?: string }).difficulty = undefined; }, /difficulty/],
    ['a broken ladder', (d) => { const day = d.calendar.days[0]!; [day.questions[0], day.questions[4]] = [day.questions[4]!, day.questions[0]!]; }, /slot 1 must be easy/],
    ['a weak late-January opening with low interest', (d) => { const day = d.calendar.days.find((x) => x.date === '2027-01-27')!; fact(d, day.questions[0]!).question.ratings.interest = 3; }, /2027-01-27: Q1 is not a recognizable/],
    ['a weak late-January opening with low recognizability', (d) => { const day = d.calendar.days.find((x) => x.date === '2027-01-27')!; fact(d, day.questions[0]!).question.ratings.recognizability = 3; }, /2027-01-27: Q1 is not a recognizable/],
    ['a weak late-January opening with low estimability', (d) => { const day = d.calendar.days.find((x) => x.date === '2027-01-27')!; fact(d, day.questions[0]!).question.ratings.estimability = 2; }, /2027-01-27: Q1 is not a recognizable/],
    ['a near-duplicate prompt', (d) => { const a = d.facts[0]!; const b = d.facts[1]!; b.question.prompt = `${a.question.prompt} `; }, /same prompt|near-duplicate/],
    ['the same fact twice', (d) => { const a = d.facts[0]!; const b = { ...structuredClone(a), id: 'nba-copy' }; b.question.prompt = 'A different wording entirely about scoring'; d.facts.push(b); d.calendar.reserve.push('nba-copy'); }, /same fact as/],
    ['steals before 1973–74', (d) => { const f = fact(d, 'nba-bird85-opener-steals'); f.season = '1970-71'; f.eventDate = null; }, /not officially recorded until 1973-74/],
    ['blocks before 1973–74', (d) => { const f = fact(d, 'nba-elmore73-half'); f.season = '1972-73'; f.eventDate = null; }, /not officially recorded until 1973-74/],
    ['turnovers before 1977–78', (d) => { const f = fact(d, 'nba-tatum22-turnovers'); f.season = '1969-70'; }, /not officially recorded until 1977-78/],
    ['three-pointers before 1979–80', (d) => { const f = fact(d, 'nba-barry80-threes'); f.season = '1978-79'; f.eventDate = null; }, /not officially recorded until 1979-80/],
    ['rebounds before 1950–51', (d) => { const f = fact(d, 'nba-wilt60-half-reb'); f.season = '1949-50'; f.eventDate = null; }, /not officially recorded until 1950-51/],
    ['a standing record without an as-of date', (d) => { fact(d, 'nba-baylor62-finals-61').source.asOf = null; }, /no asOf date/],
    ['an answer shown in the prompt', (d) => { const f = firstOf(d); f.question.prompt = `Was it ${f.answer} points that night, or fewer?`; }, /shows the answer/],
    ['a theme title that gives away an answer', (d) => { const day = d.calendar.days[0]!; day.theme.title = `The ${fact(d, day.questions[0]!).answer} night`; }, /theme title or subtitle shows the answer/],
    ['a prompt that calls a record current with no as-of date', (d) => { const f = firstOf(d); f.source.asOf = null; f.question.prompt = 'Wilt Chamberlain holds the record for points in a game. How many?'; }, /presents a record as standing today/],
    ['three of one family in a day', (d) => { for (const id of d.calendar.days[0]!.questions.slice(0, 3)) fact(d, id).family = 'points-game'; }, /from the points-game family/],
  ];
  for (const [name, mutate, expected] of cases) {
    it(`fails on ${name}`, () => {
      const d = clone();
      mutate(d);
      const errs = errorsOf(d);
      if (expected.source === '^$') {
        // re-sorting fixes order, so out-of-order input still validates as a sequence
        expect(errs.some((e) => /does not follow/.test(e))).toBe(false);
      } else {
        expect(errs.join('\n')).toMatch(expected);
      }
    });
  }
});

describe('Content versioning', () => {
  const slates = () =>
    readdirSync(DAYS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => parseSlate(JSON.parse(readFileSync(join(DAYS_DIR, f), 'utf8'))));
  it('every day file matches its locked scoring fingerprint', () => {
    const lock = readLock();
    for (const s of slates()) expect(lock[s.date], s.date).toEqual(scoringFingerprint(s));
  });
  it('keeps the mixed-sport launch days exactly as they were published', () => {
    const lock = readLock();
    expect(lock['2026-11-15']?.[0]).toBe('nba-gsw-2016-wins|73|40|82|1');
    expect(lock['2026-11-16']?.[0]).toBe('mlb-bonds-2001-hr|73|30|100|1');
    expect(real.calendar.cutover > '2026-11-16').toBe(true);
  });
  it('refuses a changed answer on a published day, but lets a future day change', () => {
    const lock = readLock();
    const all = slates();
    const first = all.find((s) => s.date === '2026-11-15')!;
    const edited = { ...first, questions: first.questions.map((q, i) => (i === 0 ? { ...q, answer: 74 } : q)) };
    const others = all.filter((s) => s.date !== first.date);
    expect(nextLock([edited, ...others], lock, '2026-11-16').refused).toEqual(['2026-11-15']);
    expect(checkPublishedLock([edited, ...others], lock, '2026-11-16').errors.join('\n')).toMatch(/2026-11-15 is published/);
    const future = all.at(-1)!;
    const moved = { ...future, questions: future.questions.map((q, i) => (i === 0 ? { ...q, min: q.min - q.step } : q)) };
    expect(nextLock([...all.slice(0, -1), moved], lock, '2026-11-16').refused).toEqual([]);
  });
  it('reports a published day whose file was deleted', () => {
    const lock = readLock();
    const rest = slates().filter((s) => s.date !== '2026-11-16');
    expect(checkPublishedLock(rest, lock, '2026-11-16').errors.join('\n')).toMatch(/2026-11-16 is published but its file is missing/);
  });
  it('day files are exactly what data/nba generates', () => {
    for (const s of buildSlates(real)) {
      expect(readFileSync(join(DAYS_DIR, `${s.date}.json`), 'utf8')).toBe(serializeSlate(s));
    }
  });
  it('rescheduling keeps every theme, id and order, makes days consecutive, and refuses a past cutover', () => {
    const next = reschedule(real.calendar, '2027-02-01', '2026-11-16');
    expect(next.days.map((d) => d.questions)).toEqual(real.calendar.days.map((d) => d.questions));
    expect(next.days.map((d) => d.theme)).toEqual(real.calendar.days.map((d) => d.theme));
    expect(next.reserve).toEqual(real.calendar.reserve);
    expect(next.days[0]!.date).toBe('2027-02-01');
    expect(next.days[49]!.date).toBe('2027-03-22');
    expect(() => reschedule(real.calendar, '2026-11-16', '2026-11-16')).toThrow(/after today/);
  });
  it('publishing as of a later day never plans a change to a published day', () => {
    const plan = planPublish(real.calendar.days[10]!.date);
    expect(plan.problems).toEqual([]);
    expect(plan.write).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
  it('the app and the calendar agree on the cutover', () => {
    expect(NBA_CUTOVER).toBe(real.calendar.cutover);
  });
  it('--today can only make the rule stricter', () => {
    expect(laterDay('2026-01-01', '2026-11-16')).toBe('2026-11-16');
    expect(laterDay('2026-12-01', '2026-11-16')).toBe('2026-12-01');
  });
});

describe('Reproducible build', () => {
  it('builds the SQLite database with integrity and the expected counts', () => {
    const db = buildDatabase(real, { today: '2026-11-16' });
    const c = counts(db);
    expect(c.stat_facts).toBe(real.facts.length);
    expect(c.daily_slates).toBe(real.calendar.days.length);
    expect(c.daily_slate_questions).toBe(real.calendar.days.length * 5);
    expect(integrity(db)).toEqual([]);
    db.close();
  });
  it('gives the same dump twice', () => {
    const a = buildDatabase(real, { today: '2026-11-16' });
    const b = buildDatabase(real, { today: '2026-11-16' });
    expect(sha256(dumpDatabase(a))).toBe(sha256(dumpDatabase(b)));
  });
  it('the database itself refuses a broken ladder', () => {
    const d = clone();
    const day = d.calendar.days[0]!;
    [day.questions[0], day.questions[4]] = [day.questions[4]!, day.questions[0]!];
    expect(() => buildDatabase(d, { today: '2026-11-16' })).toThrow(/ladder/);
  });
  it('the database itself refuses a stat from before it was recorded', () => {
    const d = clone();
    const f = fact(d, 'nba-tatum22-turnovers');
    f.season = '1969-70';
    expect(() => buildDatabase(d, { today: '2026-11-16' })).toThrow(/before the NBA kept it/);
  });
  it('committed reports in docs/nba are up to date', () => {
    for (const [name, body] of Object.entries(reportFiles(real))) {
      expect(readFileSync(join(ROOT, 'docs', 'nba', name), 'utf8'), name).toBe(body);
    }
  });
});
