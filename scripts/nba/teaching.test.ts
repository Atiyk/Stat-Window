/**
 * The teaching inventory (src/content/teaching.ts) against the verified NBA fact
 * database. Every number an example shows or asks for must come from a fact that was
 * already played as a public beta daily on or before TEACHING_PLAYED_BY, never from a
 * fact scheduled from the official restart on, nor from the Survival reserve. Derived
 * answers are recomputed with the same formatIssues the NBA pipeline uses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORMATS } from '../../src/content/formats.ts';
import { CORE_INTRO, FORMAT_GUIDE, TEACHING_EXAMPLES, TEACHING_PLAYED_BY, type TeachingExample } from '../../src/content/teaching.ts';
import { formatIssues, type FormatFact, type FormatSpec } from './formats.ts';
import { loadNbaData } from './model.ts';
import { puzzleDay } from '../../src/engine/daily.ts';

const data = loadNbaData();
const byId = new Map(data.facts.map((f) => [f.id, f] as const));
const scheduled = new Map<string, string>();
for (const d of data.calendar.days) for (const id of d.questions) scheduled.set(id, d.date);
const reserve = new Set([...data.calendar.reserve, ...Object.keys(data.calendar.reserveNotBefore ?? {})]);
/** Facts a player has already seen as a daily question during the public beta. */
const played = new Set([...scheduled].filter(([, day]) => day <= TEACHING_PLAYED_BY).map(([id]) => id));
/** Everything a scheduled-later or reserve question depends on, as sets of fact ids. */
const futureFacts = data.facts.filter((f) => reserve.has(f.id) || (scheduled.get(f.id) ?? '') > TEACHING_PLAYED_BY);

function factsUsed(e: TeachingExample): string[] {
  const b = e.basis;
  return [...new Set([
    ...(b.fact ? [b.fact] : []),
    ...(b.references ?? []),
    ...(b.chart?.map((p) => p.fact) ?? []),
    ...(b.derive?.of ?? []),
  ])];
}

/** The example in the NBA pipeline's own shape, so formatIssues can check it. */
function asFormatFact(e: TeachingExample): FormatFact {
  const q = e.question;
  const kind = q.meta!.format;
  const spec: FormatSpec | undefined = kind === 'recall' ? undefined : {
    kind,
    ...(e.basis.references ? { references: e.basis.references } : {}),
    ...(e.basis.chart && q.chart ? { chart: { title: q.chart.title, unit: q.chart.unit, points: e.basis.chart } } : {}),
    ...(e.basis.derive ? { derive: { op: e.basis.derive.op, of: e.basis.derive.of } } : {}),
    ...(e.basis.ranking ? { ranking: { population: e.basis.ranking.population, ties: e.basis.ranking.ties } } : {}),
  };
  const own = e.basis.fact && kind === 'missing-point' ? byId.get(e.basis.fact)! : undefined;
  return {
    id: own ? own.id : e.id,
    family: q.meta!.family,
    season: own?.season ?? null,
    franchise: null,
    player: null,
    answer: q.answer,
    unit: q.unit,
    source: { quote: q.source.quote, derivation: q.source.derivation ?? null },
    question: { prompt: q.prompt, context: q.context, reveal: q.note, step: q.step, max: q.max, ...(spec ? { format: spec } : {}) },
  };
}

describe('the played-by cutoff is a finished day', () => {
  // The guide can be opened before a player locks today's window, so an example built
  // from today's (or a later) daily would give its answer away. The cutoff must be a
  // day that has already ended in Eastern time, checked against the real clock.
  it('is strictly before today, Eastern', () => {
    expect(TEACHING_PLAYED_BY < puzzleDay(new Date())).toBe(true);
  });
});

describe('teaching examples are built only from verified, already-played beta facts', () => {
  it.each(TEACHING_EXAMPLES.map((e) => [e.id, e] as const))('%s', (_id, e) => {
    const used = factsUsed(e);
    expect(used.length, 'an example must name the facts it uses').toBeGreaterThan(0);
    for (const id of used) {
      expect(byId.has(id), `${id} is a verified fact`).toBe(true);
      expect(played.has(id), `${id} was played as a daily on or before ${TEACHING_PLAYED_BY}`).toBe(true);
      expect(reserve.has(id), `${id} is in the Survival reserve`).toBe(false);
      expect(scheduled.get(id)! <= TEACHING_PLAYED_BY, `${id} is scheduled on ${scheduled.get(id)}`).toBe(true);
    }
    // Same numbers, derivations and source support as the fact database.
    expect(formatIssues(asFormatFact(e), byId)).toEqual([]);
    expect(e.question.meta!.supports.every((id) => used.includes(id))).toBe(true);
    const q = e.question;
    if (e.basis.fact && !e.basis.ranking) {
      const f = byId.get(e.basis.fact)!;
      expect(q.answer).toBe(f.answer);
      expect(q.unit).toEqual(f.unit);
      expect(q.source.url).toBe(f.source.url);
      expect(q.source.quote).toBe(f.source.quote);
      expect([q.min, q.max, q.step]).toEqual([f.question.min, f.question.max, f.question.step]);
    }
    if (e.basis.chart) {
      // Every visible bar is its fact's verified value; the hidden bar is the answer.
      expect(q.chart!.points.map((p) => p.label)).toEqual(e.basis.chart.map((p) => p.label));
      q.chart!.points.forEach((p, i) => {
        const f = byId.get(e.basis.chart![i]!.fact)!;
        if (p.value === null) expect(f.id).toBe(e.basis.fact);
        else expect(p.value).toBe(f.answer);
      });
    }
    if (e.basis.derive) {
      // The source shown is one operand's own verified page and quote.
      const operands = e.basis.derive.of.map((id) => byId.get(id)!);
      expect(operands.some((f) => f.source.url === q.source.url && f.source.quote === q.source.quote)).toBe(true);
    }
    if (e.basis.ranking) {
      const f = byId.get(e.basis.fact!)!;
      expect(q.source.quote).toBe(f.source.quote);
      expect(f.source.quote).toContain(e.basis.ranking.quoted);
      expect(e.basis.ranking.quoted).toMatch(/^second only to /);
      expect(q.answer).toBe(2);
    }
    // Every printed reference figure matches its fact (formatIssues checks the prompt prints it).
    for (const id of e.basis.references ?? []) expect(byId.get(id)!.answer).toBeTypeOf('number');
  });

  it('no example repeats a scheduled or reserve question, its answer fact or its derivation', () => {
    for (const e of TEACHING_EXAMPLES) {
      const used = new Set(factsUsed(e));
      for (const f of futureFacts) {
        expect(used.has(f.id), `${e.id} uses future fact ${f.id}`).toBe(false);
        const of = f.question.format?.derive?.of;
        if (of && e.basis.derive) {
          const same = new Set([...of, ...e.basis.derive.of]).size === 2;
          expect(same, `${e.id} repeats the derivation of ${f.id} (${scheduled.get(f.id) ?? 'reserve'})`).toBe(false);
        }
        // A derived or charted figure equal to a future answer about the same facts would spoil it.
        if (e.basis.derive && of && of.some((id) => used.has(id))) expect(f.answer, `${e.id} vs ${f.id}`).not.toBe(e.question.answer);
      }
    }
  });

  it('teaching ids never collide with a published question id', () => {
    const published = new Set<string>();
    for (const file of readdirSync('content/days')) {
      const slate = JSON.parse(readFileSync(`content/days/${file}`, 'utf8')) as { questions: { id: string }[] };
      for (const q of slate.questions) published.add(q.id);
    }
    for (const e of [...TEACHING_EXAMPLES, CORE_INTRO]) expect(published.has(e.id)).toBe(false);
  });

  it('the first-play Warriors record is printed in a verified source quote and asked by no scheduled question', () => {
    const quotes = data.facts.flatMap((f) => [f.source.quote, ...(f.question.funFacts ?? []).map((x) => x.source.quote)]);
    expect(quotes).toContain(CORE_INTRO.question.source.quote);
    expect(CORE_INTRO.question.source.quote).toContain('73–9');
    const asksIt = data.facts.filter((f) => f.franchise === 'GSW' && f.season === '2015-16' && f.answer === 73 && f.family === 'wins-season');
    expect(asksIt).toEqual([]);
  });

  it('covers every canonical format', () => {
    expect(TEACHING_EXAMPLES.map((e) => e.question.meta!.format)).toEqual([...FORMATS]);
    for (const f of FORMATS) expect(FORMAT_GUIDE[f].example.question.meta!.format).toBe(f);
  });
});
