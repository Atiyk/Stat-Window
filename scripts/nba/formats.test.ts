import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAnswer, formatIssues, metaOf, resolveChart, supportsOf, type FormatFact, type FormatSpec } from './formats.ts';
import { PLAYER_FORMATS, sequenceIssues, slateFormatIssues, VARIETY_FROM } from '../../src/content/formats.ts';
import { buildSlates, loadNbaData, questionFromFact, ROOT, V5_CONTENT_FROM, v5Context, validateNba, type Fact, type NbaData } from './model.ts';
import { buildCatalog, leakHorizon } from './survival.ts';
import { parseSlate, QuestionSchema } from '../../src/content/schema.ts';
import { formatOf } from '../../src/content/formats.ts';

const base = (id: string, answer: number, extra: Partial<FormatFact> = {}, step = 1): FormatFact => ({
  id,
  family: 'scoring-average',
  season: '2005-06',
  franchise: 'LAL',
  player: 'Kobe Bryant',
  answer,
  unit: { singular: 'point per game', plural: 'points per game' },
  source: { quote: '', derivation: null },
  question: { prompt: `What did ${id} average?`, context: 'ctx', reveal: 'reveal', step, max: 1000 },
  ...extra,
});
const withFormat = (f: FormatFact, format: FormatSpec, patch: Partial<FormatFact['question']> = {}): FormatFact => ({
  ...f,
  question: { ...f.question, ...patch, format },
});
const index = (...fs: FormatFact[]) => new Map(fs.map((f) => [f.id, f]));

describe('derivations', () => {
  it('rounds to the question step', () => {
    expect(deriveAnswer('difference', 37.1, 35.4, 0.1)).toBe(1.7);
    expect(deriveAnswer('sum', 72, 15, 1)).toBe(87);
    expect(deriveAnswer('percent', 402, 1000, 0.1)).toBe(40.2);
    expect(deriveAnswer('percent', 1, 3, 1)).toBe(33);
    expect(deriveAnswer('percent', 1, 0, 1)).toBeNaN();
  });
});

describe('reference questions', () => {
  const jordan = base('nba-jordan87-ppg', 37.1, { season: '1986-87', player: 'Michael Jordan', franchise: 'CHI' }, 0.1);
  const kobe = base('nba-kobe06-ppg', 35.4, {}, 0.1);
  it('accept a prompt that prints the verified reference figure', () => {
    const q = withFormat(kobe, { kind: 'reference', references: [jordan.id] }, { prompt: 'Jordan averaged 37.1 in 1986–87. What did Kobe average in 2005–06?' });
    expect(formatIssues(q, index(jordan, q))).toEqual([]);
  });
  it('reject a prompt whose figure differs from the verified fact', () => {
    const q = withFormat(kobe, { kind: 'reference', references: [jordan.id] }, { prompt: 'Jordan averaged 37.0 in 1986–87. What did Kobe average in 2005–06?' });
    expect(formatIssues(q, index(jordan, q)).join()).toMatch(/must print the verified figure/);
  });
  it('reject an unknown or self reference, and a reference question without one', () => {
    expect(formatIssues(withFormat(kobe, { kind: 'reference', references: ['nba-nope'] }), index(kobe)).join()).toMatch(/not a verified fact/);
    expect(formatIssues(withFormat(kobe, { kind: 'reference', references: [kobe.id] }), index(kobe)).join()).toMatch(/question itself/);
    expect(formatIssues(withFormat(kobe, { kind: 'reference' }), index(kobe)).join()).toMatch(/at least one reference/);
  });
});

describe('missing-point charts', () => {
  const wins = (id: string, answer: number, season: string) => base(id, answer, { family: 'wins-season', season, player: null, franchise: 'BOS', unit: { singular: 'win', plural: 'wins' } });
  // Fixture values sit more than 5% from one another (the near-collision gate below).
  const a = wins('nba-c73', 78, '1972-73');
  const b = wins('nba-c86', 70, '1985-86');
  const c = wins('nba-c08', 60, '2007-08');
  const spec = (points: { label: string; fact: string }[]): FormatSpec => ({ kind: 'missing-point', chart: { title: 'Regular-season wins', unit: 'wins', points } });
  const q = withFormat(c, spec([{ label: '1985–86', fact: b.id }, { label: '2007–08', fact: c.id }, { label: '1972–73', fact: a.id }]));

  it('rejects bars in value order, whose neighbours would bracket the hidden answer', () => {
    const sorted = withFormat(c, spec([{ label: '1972–73', fact: a.id }, { label: '1985–86', fact: b.id }, { label: '2007–08', fact: c.id }]));
    expect(formatIssues(sorted, index(a, b, sorted)).join()).toMatch(/value order/);
  });
  it('resolves verified values and hides exactly the answer', () => {
    expect(formatIssues(q, index(a, b, q))).toEqual([]);
    expect(resolveChart(q, index(a, b, q))).toEqual({
      title: 'Regular-season wins',
      unit: 'wins',
      points: [{ label: '1985–86', value: 70 }, { label: '2007–08', value: null }, { label: '1972–73', value: 78 }],
    });
  });
  it('rejects a known bar within 5% of the hidden answer (it would give the answer away)', () => {
    const near = wins('nba-near', 63, '1990-91'); // |63 − 60| = 3 ≤ 0.05 × 60
    const chart = withFormat(c, spec([{ label: '1985–86', fact: b.id }, { label: '2007–08', fact: c.id }, { label: '1990–91', fact: near.id }]));
    expect(formatIssues(chart, index(b, near, chart)).join()).toMatch(/nba-near \(63\) is within 5% of the hidden answer 60/);
    const clear = wins('nba-clear', 64, '1990-91'); // 4 > 3: far enough
    const ok = withFormat(c, spec([{ label: '1985–86', fact: b.id }, { label: '2007–08', fact: c.id }, { label: '1990–91', fact: clear.id }]));
    expect(formatIssues(ok, index(b, clear, ok))).toEqual([]);
    // Only the untimed walkthrough example, whose lesson is the cluster, is exempt.
    expect(formatIssues(chart, index(b, near, chart), { teaching: true })).toEqual([]);
  });
  it('requires the question itself exactly once, 3–7 points and distinct labels', () => {
    expect(formatIssues(withFormat(c, spec([{ label: 'x', fact: a.id }, { label: 'y', fact: b.id }, { label: 'z', fact: a.id }])), index(a, b, c)).join()).toMatch(/exactly once/);
    expect(formatIssues(withFormat(c, spec([{ label: 'x', fact: a.id }, { label: 'y', fact: c.id }])), index(a, b, c)).join()).toMatch(/3–7 observations/);
    expect(formatIssues(withFormat(c, spec([{ label: 'x', fact: a.id }, { label: 'x', fact: b.id }, { label: 'z', fact: c.id }])), index(a, b, c)).join()).toMatch(/distinct/);
  });
  it('rejects observations in another unit or stat family', () => {
    const ppg = base('nba-ppg', 30);
    expect(formatIssues(withFormat(c, spec([{ label: 'x', fact: a.id }, { label: 'y', fact: ppg.id }, { label: 'z', fact: c.id }])), index(a, ppg, c)).join()).toMatch(/not wins/);
  });
  it('requires a chart for missing-point, and refuses one on a plain reference', () => {
    expect(formatIssues(withFormat(c, { kind: 'missing-point' }), index(c)).join()).toMatch(/needs a chart/);
    expect(formatIssues(withFormat(c, { kind: 'reference', references: [a.id], chart: spec([]).chart! }, { prompt: 'Boston won 68 in 1972–73.' }), index(a, c)).join()).toMatch(/only missing-point/);
  });
  it('the game schema accepts one hidden bar and rejects two', () => {
    const v5 = { byId: index(a, b, q) as never, franchiseName: () => 'Boston Celtics' };
    const shown = { ...questionFromFact(realFirst(), undefined) };
    const chart = resolveChart(q, v5.byId)!;
    const ok = { ...shown, chart, meta: { format: 'missing-point', family: 'wins-season', era: 'cross-era', subjects: [], supports: [] } };
    expect(QuestionSchema.safeParse(ok).success).toBe(true);
    const twoHidden = { ...ok, chart: { ...chart, points: chart.points.map((p) => ({ ...p, value: null })) } };
    expect(QuestionSchema.safeParse(twoHidden).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...ok, meta: { ...ok.meta, format: 'reference' } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...shown, meta: ok.meta }).success).toBe(false);
  });
});

describe('derived questions: difference, ratio, sum', () => {
  const wilt = base('nba-wilt', 100, { family: 'points-game', season: '1961-62', player: 'Wilt Chamberlain', franchise: 'GSW', unit: { singular: 'point', plural: 'points' } });
  const kobe = base('nba-kobe', 81, { family: 'points-game', player: 'Kobe Bryant', unit: { singular: 'point', plural: 'points' } });
  const gap = (answer: number, derivation: string | null, op: 'difference' | 'percent' = 'difference', kind: FormatSpec['kind'] = 'difference') =>
    withFormat(base('nba-gap', answer, { family: 'points-game', unit: { singular: 'point', plural: 'points' }, source: { quote: '', derivation } }), { kind, derive: { op, of: [wilt.id, kobe.id] } });

  it('accepts the recomputed answer with a derivation that shows both operands', () => {
    expect(formatIssues(gap(19, '100 − 81 = 19'), index(wilt, kobe))).toEqual([]);
  });
  it('rejects a wrong answer, a missing derivation, or one that omits an operand', () => {
    expect(formatIssues(gap(18, '100 − 81 = 18'), index(wilt, kobe)).join()).toMatch(/does not match difference/);
    expect(formatIssues(gap(19, null), index(wilt, kobe)).join()).toMatch(/needs source.derivation/);
    expect(formatIssues(gap(19, 'Wilt minus Kobe is 19'), index(wilt, kobe)).join()).toMatch(/must show operand nba-wilt/);
  });
  it('requires the right operation for each family', () => {
    expect(formatIssues(gap(123, '100 / 81 = 123%', 'percent', 'difference'), index(wilt, kobe)).join()).toMatch(/derives a difference/);
    expect(formatIssues(gap(19, '100 − 81 = 19', 'difference', 'ratio'), index(wilt, kobe)).join()).toMatch(/derives a percent/);
    expect(formatIssues(withFormat(base('nba-r', 5), { kind: 'ratio' }), index()).join()).toMatch(/needs a derivation/);
  });
  it('a share cannot exceed its whole', () => {
    const part = base('nba-part', 50, { unit: { singular: '%', plural: '%' } });
    const whole = base('nba-whole', 40, { unit: { singular: '%', plural: '%' } });
    const share = withFormat(base('nba-share', 125, { unit: { singular: '%', plural: '%' }, source: { quote: '', derivation: '50 / 40' } }), { kind: 'ratio', derive: { op: 'percent', of: [part.id, whole.id] } });
    expect(formatIssues(share, index(part, whole)).join()).toMatch(/cannot exceed/);
  });
});

describe('derivations from figures in the fact\'s own quote', () => {
  const oscar = (answer: number, quote: string, derivation: string | null, values: [number, number] = [899, 715]) =>
    withFormat(base('nba-oscar', answer, { family: 'assists-season', unit: { singular: 'assist', plural: 'assists' }, source: { quote, derivation } }), { kind: 'difference', derive: { op: 'difference', values } });
  const quote = 'He broke the assists record by Bob Cousy, who had recorded 715 assists two seasons earlier, by logging 899';
  it('accepts values the verified quote prints, recomputed', () => {
    expect(formatIssues(oscar(184, quote, '899 − 715 = 184'), index())).toEqual([]);
  });
  it('rejects a value the quote does not print, a wrong answer, or both of and values', () => {
    expect(formatIssues(oscar(185, quote, '900 − 715 = 185', [900, 715]), index()).join()).toMatch(/not printed in this fact's verified quote/);
    expect(formatIssues(oscar(183, quote, '899 − 715 = 183'), index()).join()).toMatch(/does not match difference/);
    const both = withFormat(base('nba-x', 1, { source: { quote, derivation: '899 − 715' } }), { kind: 'difference', derive: { op: 'difference', values: [899, 715], of: ['a', 'b'] } });
    expect(formatIssues(both, index()).join()).toMatch(/either two fact ids/);
  });
  it('quoted values are not supports (nothing else is shown)', () => {
    expect(supportsOf(oscar(184, quote, '899 − 715 = 184'))).toEqual([]);
  });
});

describe('ranking and trajectory', () => {
  it('a ranking states its population and tie rule', () => {
    const r = base('nba-rank', 4);
    expect(formatIssues(withFormat(r, { kind: 'ranking' }), index(r)).join()).toMatch(/population and tie/);
    expect(formatIssues(withFormat(r, { kind: 'ranking', ranking: { population: 'all NBA players, regular season', ties: 'shared rank' } }), index(r))).toEqual([]);
  });
  it('a recall question with a ranking spec states its population and tie rule too (taxonomy v2)', () => {
    const r = base('nba-rank', 4);
    const recall = (ranking: { population: string; ties: string }) => formatIssues(withFormat(r, { kind: 'recall', ranking }), index(r)).join();
    expect(recall({ population: '', ties: 'shared rank' })).toMatch(/population and tie/);
    expect(recall({ population: 'all NBA players, regular season', ties: ' ' })).toMatch(/population and tie/);
    expect(recall({ population: 'all NBA players, regular season', ties: 'shared rank' })).toBe('');
  });
  it('a trajectory needs a derivation', () => {
    const t = base('nba-t', 4);
    expect(formatIssues(withFormat(t, { kind: 'trajectory' }), index(t)).join()).toMatch(/needs a derivation/);
  });
  it('a chart observation must fit the question scale and step', () => {
    const own = base('nba-own', 30);
    const big = base('nba-big', 2000);
    const fine = base('nba-fine', 27.5, {}, 0.1);
    const other = base('nba-o', 20);
    const chart = (facts: string[]) => ({ kind: 'missing-point' as const, chart: { title: 'Points per game', unit: 'points', points: facts.map((fact, i) => ({ label: `P${i}`, fact })) } });
    const issues = formatIssues(withFormat(own, chart(['nba-own', 'nba-big', 'nba-fine', 'nba-o'])), index(own, big, fine, other)).join('\n');
    expect(issues).toMatch(/nba-big \(2000\) is above the scale's max 1000/);
    expect(issues).toMatch(/nba-fine \(27.5\) cannot be shown at this question's step 1/);
    expect(issues).not.toMatch(/nba-o /);
  });
  it('a chart only goes with the missing-point format', () => {
    const own = base('nba-own', 30);
    const spec = { kind: 'trajectory' as const, derive: { op: 'sum' as const, values: [10, 20] as [number, number] }, chart: { title: 'Points per game', unit: 'points', points: [] } };
    expect(formatIssues(withFormat(own, spec), index(own)).join()).toMatch(/only missing-point questions carry a chart/);
  });
  it('rejects plain recall written as a format', () => {
    const t = base('nba-t', 4);
    expect(formatIssues(withFormat(t, { kind: 'recall' as never }), index(t)).join()).toMatch(/omit format/);
  });
});

describe('classification metadata', () => {
  const jordan = base('nba-j', 37.1, { season: '1986-87', player: 'Michael Jordan', franchise: 'CHI' }, 0.1);
  const kobe = withFormat(base('nba-k', 35.4, {}, 0.1), { kind: 'reference', references: ['nba-j'] });
  it('names format, family, subjects and supports, and labels cross-era comparisons honestly', () => {
    expect(metaOf(kobe, index(jordan, kobe), (id) => (id === 'LAL' ? 'Los Angeles Lakers' : id))).toEqual({
      format: 'reference', family: 'scoring-average', era: 'cross-era', subjects: ['Kobe Bryant', 'Los Angeles Lakers'], supports: ['nba-j'],
    });
    expect(metaOf(jordan, index(jordan), (id) => id).era).toBe('1980s');
    expect(metaOf({ ...jordan, season: null }, index(jordan), (id) => id).era).toBe('timeless');
    expect(supportsOf(jordan)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real database and calendar.

const real = loadNbaData();
function realFirst(): Fact {
  return real.facts.find((f) => f.id === real.calendar.days[0]!.questions[0])!;
}
const clone = (): NbaData => structuredClone(real);

describe('V5 formats in the real calendar', () => {
  it('days before the V5 boundary keep their exact published shape (no meta, no chart)', () => {
    for (const s of buildSlates(real)) {
      const v5 = s.date >= V5_CONTENT_FROM;
      for (const q of s.questions) {
        expect(q.meta !== undefined).toBe(v5);
        if (!v5) expect(q.chart).toBeUndefined();
      }
      parseSlate(s);
    }
  });
  it('every V5 question resolves to the format it declares', () => {
    const v5 = v5Context(real);
    for (const f of real.facts) {
      const q = questionFromFact(f, v5);
      expect(formatOf(q)).toBe(f.question.format?.kind ?? 'recall');
      expect(q.chart !== undefined).toBe(f.question.format?.chart !== undefined);
    }
  });
  it('refuses a support that is played on the same day or later (spoiler)', () => {
    const d = clone();
    const day = d.calendar.days.at(-2)!;
    const later = d.calendar.days.at(-1)!;
    const f = d.facts.find((x) => x.id === day.questions[1])!;
    const g = d.facts.find((x) => x.id === later.questions[1])!;
    f.question.format = { kind: 'reference', references: [g.id] };
    f.question.prompt = `${g.answer} for context. ${f.question.prompt}`.slice(0, 140);
    const errors = validateNba(d).errors.join('\n');
    expect(errors).toMatch(new RegExp(`${f.id} shows or derives from ${g.id}, which is not played until ${later.date}`));
  });
  it('holds a Survival question back until every fact it shows has been played', () => {
    const d = clone();
    const reserve = d.facts.find((x) => x.id === d.calendar.reserve[0])!;
    const last = d.calendar.days.at(-1)!;
    const g = d.facts.find((x) => x.id === last.questions[0])!;
    reserve.question.format = { kind: 'reference', references: [g.id] };
    const scheduled = new Map(d.calendar.days.flatMap((x) => x.questions.map((id) => [id, x.date] as const)));
    const horizon = leakHorizon(reserve, scheduled, d.facts);
    expect(horizon.leaks).toContain(g.id);
    expect(horizon.notBefore! > last.date).toBe(true);
    expect(buildCatalog(d).tags[reserve.id]!.notBefore! > last.date).toBe(true);
  });
});

type AuditFile = { entries: { day: string; slot: number; id: string; verdict: string; format: string; note: string; replaced?: string }[] };
const readAuditFile = (name: string) => JSON.parse(readFileSync(join(ROOT, 'data', 'nba', 'editorial', name), 'utf8')) as AuditFile;
const v52AuditStart = '2026-11-30';
const v53Audit = readAuditFile('v53-audit.json');
const kind = (id: string) => real.facts.find((x) => x.id === id)!.question.format?.kind ?? 'recall';

describe('V5 launch inventory audit', () => {
  const audit = readAuditFile('launch-audit.json');
  const launch = real.calendar.days.filter((d) => d.date >= V5_CONTENT_FROM);
  it('records exactly one reviewed decision for every V5.0 launch-inventory slot', () => {
    expect(audit.entries.length).toBe(launch.length * 5);
    const slots = new Set(audit.entries.map((e) => `${e.day}#${e.slot}`));
    for (const d of launch) for (let i = 1; i <= 5; i++) expect(slots.has(`${d.date}#${i}`), `${d.date} Q${i}`).toBe(true);
  });
  it('V5.3’s earlier launch keeps the two original V5.0 days’ question IDs and order', () => {
    const bySlot = new Map(audit.entries.map((e) => [`${e.day}#${e.slot}`, e]));
    for (const d of launch.filter((x) => x.date < v52AuditStart)) d.questions.forEach((id, i) => {
      const e = bySlot.get(`${d.date}#${i + 1}`);
      expect(e?.id, `${d.date} Q${i + 1}`).toBe(id);
      expect(e!.note.trim().length).toBeGreaterThan(5);
    });
  });
});

describe('V5.1 official-season audit (frozen record)', () => {
  const audit = readAuditFile('v51-audit.json');
  const official = real.calendar.days.filter((d) => d.date >= v52AuditStart);
  it('still records one decision per historical slot', () => {
    expect(audit.entries.length).toBe(official.length * 5);
    for (const e of audit.entries) expect(e.note.trim().length).toBeGreaterThan(5);
  });
});

describe('Official-season audits (V5.2 and V5.3)', () => {
  const v52Audit = readAuditFile('v52-audit.json');
  const official = real.calendar.days.filter((d) => d.date >= VARIETY_FROM);
  const entries = [...v53Audit.entries, ...v52Audit.entries];
  it('records exactly one editorial decision per official slot, naming the question now in it', () => {
    const bySlot = new Map(entries.map((e) => [`${e.day}#${e.slot}`, e]));
    expect(v52Audit.entries.every((e) => e.day >= v52AuditStart)).toBe(true);
    expect(v53Audit.entries.every((e) => e.day < v52AuditStart)).toBe(true);
    expect(entries.length).toBe(official.length * 5);
    for (const d of official) d.questions.forEach((id, i) => {
      const e = bySlot.get(`${d.date}#${i + 1}`);
      expect(e?.id, `${d.date} Q${i + 1}`).toBe(id);
      expect(['retained', 'reframed', 'replaced']).toContain(e!.verdict);
      expect(e!.note.trim().length).toBeGreaterThan(5);
      expect(e!.format).toBe(kind(id));
    });
  });
  it('every official slate uses all three formats in a 2/2/1 distribution', () => {
    for (const d of official) expect(slateFormatIssues(d.questions.map(kind)), d.date).toEqual([]);
  });
  it('no two consecutive official days repeat a format sequence', () => {
    expect(sequenceIssues(official.map((d) => d.questions.map(kind)))).toEqual([]);
  });
  it('rotates the single format across the catalog (each is the single on at least a quarter of days)', () => {
    const singles = new Map<string, number>();
    for (const d of official) {
      const counts = new Map<string, number>();
      for (const id of d.questions) counts.set(kind(id), (counts.get(kind(id)) ?? 0) + 1);
      for (const [f, n] of counts) if (n === 1) singles.set(f, (singles.get(f) ?? 0) + 1);
    }
    for (const f of PLAYER_FORMATS) expect(singles.get(f) ?? 0, f).toBeGreaterThanOrEqual(Math.floor(official.length / 4));
  });
});
