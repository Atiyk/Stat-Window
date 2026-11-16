import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSlate } from '../../src/content/schema.ts';
import { buildDatabase, counts, dumpDatabase, integrity } from './db.ts';
import {
  buildSlates, loadNbaData, MIN_DAYS, MIN_FACTS, ROOT, serializeSlate, sha256, validateNba, type Fact, type NbaData,
} from './model.ts';
import { checkLock, DAYS_DIR, readLock } from './publish.ts';
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
  it('every day file matches its locked hash', () => {
    expect(checkLock()).toEqual([]);
  });
  it('locks the days that were live before the NBA cutover', () => {
    const lock = readLock();
    for (const day of ['2026-11-15', '2026-11-16', '2026-11-17']) expect(lock.days[day]).toMatch(/^[0-9a-f]{64}$/);
  });
  it('detects a silently changed published question', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sw-lock-'));
    cpSync(DAYS_DIR, dir, { recursive: true });
    const path = join(dir, '2026-11-15.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"answer": 73', '"answer": 74'));
    expect(checkLock(dir).join('\n')).toMatch(/2026-11-15\.json changed since it was locked/);
  });
  it('day files are exactly what data/nba generates', () => {
    for (const s of buildSlates(real)) {
      expect(readFileSync(join(DAYS_DIR, `${s.date}.json`), 'utf8')).toBe(serializeSlate(s));
    }
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
