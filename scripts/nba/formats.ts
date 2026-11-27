/**
 * V5 question formats over the verified NBA fact database.
 *
 * A fact may carry `question.format`, which says how the question is framed and
 * which *other verified facts* it relies on:
 *
 *   references  facts whose verified figure the prompt prints as a reasoning anchor
 *   chart       observations shown as a small bar chart, one of which is this fact
 *               (the hidden bar the player estimates)
 *   derive      the answer is computed from two verified facts (difference, percent, sum)
 *   ranking     population and tie convention for an objective rank or count
 *
 * Nothing here trusts prose: every figure shown or derived comes from a fact id, and
 * `formatIssues` recomputes every derivation and checks every printed reference.
 */
import { stepDecimals } from '../../src/engine/scoring.ts';
import { answerSpellings } from '../../src/content/schema.ts';
import { FORMATS, type QuestionChart, type QuestionFormat, type QuestionMeta } from '../../src/content/formats.ts';

export type DeriveOp = 'difference' | 'percent' | 'sum';

export type FormatSpec = {
  /**
   * Player-facing format. `recall` is written explicitly only when the answer is
   * derived or ranked (taxonomy v2: a computed statistic is still a recall question).
   */
  kind: QuestionFormat;
  references?: string[];
  chart?: { title: string; unit: string; points: { label: string; fact: string }[] };
  /**
   * `of`: two verified fact ids. `values`: two figures printed in this fact's own
   * verified source quote (for example "899 … breaking Cousy's 715"). Exactly one.
   */
  derive?: { op: DeriveOp; of?: [string, string]; values?: [number, number] };
  ranking?: { population: string; ties: string };
};

/** The slice of a fact this module reads (kept structural so model.ts can import it without a cycle). */
export type FormatFact = {
  id: string;
  family: string;
  season: string | null;
  franchise: string | null;
  player: string | null;
  answer: number;
  unit: { singular: string; plural: string };
  source: { quote: string; derivation: string | null };
  question: { prompt: string; context: string; reveal: string; step: number; max: number; format?: FormatSpec };
};

const round = (n: number, step: number) => Number(n.toFixed(stepDecimals(step)));

/** The answer a derivation produces, rounded to the question's step decimals. */
export function deriveAnswer(op: DeriveOp, a: number, b: number, step: number): number {
  if (op === 'difference') return round(a - b, step);
  if (op === 'sum') return round(a + b, step);
  if (b === 0) return Number.NaN;
  return round((100 * a) / b, step);
}

/** Every other fact a question depends on, in a stable order without repeats. */
export function supportsOf(f: Pick<FormatFact, 'id' | 'question'>): string[] {
  const spec = f.question.format;
  if (!spec) return [];
  const ids = [
    ...(spec.references ?? []),
    ...(spec.chart?.points.map((p) => p.fact) ?? []),
    ...(spec.derive?.of ?? []),
  ].filter((id) => id !== f.id);
  return [...new Set(ids)];
}

/** Figures in `text` as digits (not number words), the same way leaksAnswer reads a prompt. */
function prints(text: string, value: number, step: number): boolean {
  return answerSpellings(value, step).some((s) => !/^[a-z]+$/.test(s) && new RegExp(`(^|[^0-9.,])${s.replace(/[.,]/g, (c) => `\\${c}`)}(?![0-9]|[.,][0-9])`).test(text));
}

/**
 * Issues with one fact's format, given every fact by id. Empty means valid.
 * `teaching`: the untimed walkthrough example, whose lesson is reading a tight cluster of
 * bars, so the near-collision gate (a known bar within 5% of the answer) does not apply.
 */
export function formatIssues(f: FormatFact, byId: ReadonlyMap<string, FormatFact>, opts: { teaching?: boolean } = {}): string[] {
  const spec = f.question.format;
  if (!spec) return [];
  const out: string[] = [];
  if (!(FORMATS as readonly string[]).includes(spec.kind)) {
    out.push(`unknown format ${spec.kind}`);
    return out;
  }
  if (spec.kind === 'recall' && !spec.derive && !spec.ranking && !spec.references?.length && !spec.chart)
    out.push('omit format for plain recall (write kind recall only with a derivation or ranking)');
  if (spec.kind === 'recall' && (spec.references?.length || spec.chart)) out.push('a recall question prints no reference and shows no chart');
  const get = (id: string, role: string) => {
    if (id === f.id) {
      out.push(`${role} cannot be the question itself`);
      return undefined;
    }
    const g = byId.get(id);
    if (!g) out.push(`${role} ${id} is not a verified fact`);
    return g;
  };
  const shown = `${f.question.prompt} ${f.question.context}`;

  for (const id of spec.references ?? []) {
    const g = get(id, 'reference');
    if (g && !prints(shown, g.answer, g.question.step) && !(Number.isInteger(g.answer) && prints(shown, g.answer, 1)))
      out.push(`prompt must print the verified figure of reference ${id} (${g.answer})`);
  }
  if (spec.kind === 'reference' && !spec.references?.length) out.push('a reference question needs at least one reference fact');

  if (spec.chart) {
    const { points, title, unit } = spec.chart;
    if (spec.kind !== 'missing-point') out.push('only missing-point questions carry a chart (the schema ties a chart to that format)');
    if (points.length < 3 || points.length > 7) out.push(`a chart needs 3–7 observations, found ${points.length}`);
    if (points.filter((p) => p.fact === f.id).length !== 1) out.push('a chart must contain the question itself exactly once, as the hidden observation');
    if (new Set(points.map((p) => p.label)).size !== points.length) out.push('chart labels must be distinct');
    if (!title.trim() || title.length > 48) out.push('chart title must be 1–48 characters');
    if (!unit.trim() || unit.length > 16) out.push('chart unit must be 1–16 characters');
    for (const p of points) {
      if (!p.label.trim() || p.label.length > 14) out.push(`chart label "${p.label}" must be 1–14 characters`);
      if (p.fact === f.id) continue;
      const g = get(p.fact, 'chart observation');
      if (g && g.unit.plural !== f.unit.plural) out.push(`chart observation ${g.id} is in ${g.unit.plural}, not ${f.unit.plural}`);
      if (g && g.family !== f.family) out.push(`chart observation ${g.id} measures ${g.family}, not ${f.family}`);
      if (g && g.answer > f.question.max) out.push(`chart observation ${g.id} (${g.answer}) is above the scale's max ${f.question.max}`);
      // A bar this close to the hidden one hands over the answer (42 beside a hidden 43).
      if (g && !opts.teaching && Math.abs(g.answer - f.answer) <= 0.05 * Math.abs(f.answer) + 1e-9)
        out.push(`chart observation ${g.id} (${g.answer}) is within 5% of the hidden answer ${f.answer}; pick a bar further away`);
      if (g && Math.abs(Math.round(g.answer / f.question.step) * f.question.step - g.answer) > 1e-9)
        out.push(`chart observation ${g.id} (${g.answer}) cannot be shown at this question's step ${f.question.step}`);
    }
    // The chart draws bars in array order. If every bar, the hidden one included, runs in
    // value order, its neighbours bracket the answer: order bars by season, game or name.
    const values = points.map((p) => (p.fact === f.id ? f.answer : byId.get(p.fact)?.answer));
    if (values.length >= 3 && values.every((v) => v !== undefined)) {
      const vs = values as number[];
      const up = vs.every((v, i) => i === 0 || v >= vs[i - 1]!);
      const down = vs.every((v, i) => i === 0 || v <= vs[i - 1]!);
      if (up || down) out.push('chart bars run in value order around the hidden bar, so its neighbours give the answer away; reorder them (by season or name)');
    }
  } else if (spec.kind === 'missing-point') out.push('a missing-point question needs a chart');

  if (spec.derive) {
    const { op, of, values } = spec.derive;
    const why = f.source.derivation ?? '';
    if (!why) out.push('a derived answer needs source.derivation');
    let operands: { label: string; answer: number; step: number }[] = [];
    if ((of === undefined) === (values === undefined)) out.push('a derivation takes either two fact ids (of) or two quoted values (values)');
    else if (of) {
      if (of.length !== 2 || of[0] === of[1]) out.push('a derivation needs two different operands');
      const [a, b] = of.map((id, i) => get(id, `operand ${i + 1}`));
      if (a && b) operands = [a, b].map((g) => ({ label: g.id, answer: g.answer, step: g.question.step }));
    } else if (values) {
      if (values.length !== 2) out.push('a derivation needs two values');
      for (const v of values) {
        const quoted = prints(f.source.quote, v, f.question.step) || (Number.isInteger(v) && prints(f.source.quote, v, 1)) || f.source.quote.includes(v.toLocaleString('en-US'));
        if (!quoted) out.push(`derived value ${v} is not printed in this fact's verified quote`);
      }
      operands = values.map((v) => ({ label: `quoted ${v}`, answer: v, step: f.question.step }));
    }
    if (operands.length === 2) {
      const [a, b] = operands as [typeof operands[0], typeof operands[0]];
      const want = deriveAnswer(op, a.answer, b.answer, f.question.step);
      if (!Number.isFinite(want)) out.push('derivation divides by zero');
      else if (want !== f.answer) out.push(`answer ${f.answer} does not match ${op} of ${a.label} (${a.answer}) and ${b.label} (${b.answer}) = ${want}`);
      for (const g of operands) {
        const shownIn = prints(why, g.answer, g.step) || (Number.isInteger(g.answer) && prints(why, g.answer, 1)) || why.includes(g.answer.toLocaleString('en-US'));
        if (why && !shownIn) out.push(`source.derivation must show operand ${g.label} (${g.answer})`);
      }
      if (op === 'percent' && a.answer > b.answer && f.unit.plural === '%') out.push('a share cannot exceed its whole');
    }
  }
  if ((spec.kind === 'difference' || spec.kind === 'ratio') && !spec.derive) out.push(`a ${spec.kind} question needs a derivation`);
  if (spec.kind === 'ratio' && spec.derive && spec.derive.op !== 'percent') out.push('a ratio question derives a percent');
  if (spec.kind === 'difference' && spec.derive && spec.derive.op !== 'difference') out.push('a difference question derives a difference');
  if (spec.kind === 'trajectory' && !spec.derive) out.push('a trajectory question needs a derivation');
  // A ranked count is a recall question under taxonomy v2; its ranking spec is held to the same rule.
  if ((spec.kind === 'ranking' || spec.ranking) && !(spec.ranking?.population?.trim() && spec.ranking.ties?.trim()))
    out.push('a ranking question must state its population and tie convention');
  return out;
}

/** The chart as the game shows it: verified values, with this question's own value hidden. */
export function resolveChart(f: FormatFact, byId: ReadonlyMap<string, FormatFact>): QuestionChart | undefined {
  const c = f.question.format?.chart;
  if (!c) return undefined;
  return {
    title: c.title,
    unit: c.unit,
    points: c.points.map((p) => ({ label: p.label, value: p.fact === f.id ? null : byId.get(p.fact)!.answer })),
  };
}

const decade = (season: string | null): string | null => (season ? `${Math.floor(Number(season.slice(0, 4)) / 10) * 10}s` : null);

/** Classification for the day file and the future Scouting Report. */
export function metaOf(f: FormatFact, byId: ReadonlyMap<string, FormatFact>, franchiseName: (id: string) => string): QuestionMeta {
  const supports = supportsOf(f);
  const own = decade(f.season);
  // A comparison across decades is labelled as such rather than filed under one of them.
  const eras = new Set([own, ...supports.map((id) => decade(byId.get(id)?.season ?? null))].filter((e): e is string => e !== null));
  const era = eras.size > 1 ? 'cross-era' : own ?? 'timeless';
  const subjects = [f.player, f.franchise ? franchiseName(f.franchise) : null].filter((s): s is string => !!s);
  return { format: f.question.format?.kind ?? 'recall', family: f.family, era, subjects, supports };
}
