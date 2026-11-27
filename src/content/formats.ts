import * as z from 'zod/mini';

/**
 * Question formats. Every format is answered with the same brackets, scored by the
 * same formula, on the same 24-second clock: a format only changes what the player is
 * shown before the lock and how the reveal explains the answer.
 *
 * Taxonomy v2 (V5.2) has three player-facing formats (`PLAYER_FORMATS`):
 * - `recall`: a clear numerical question on its own. The answer may still be computed
 *   from verified figures (a gap, a share, a rank); that is the underlying statistic,
 *   not a separate format.
 * - `reference`: the prompt gives a related verified figure that genuinely helps the
 *   player reason toward the answer.
 * - `missing-point`: a small chart of related verified observations with one gap; the
 *   gap is the answer and fills in on reveal.
 *
 * `FORMATS` is the storage schema and still lists V5/V5.1's four retired formats
 * (`RETIRED_FORMATS`), because published beta day files, saved runs and Survival's
 * reserve keep the label they were played with. Official slates never use them.
 */
export const PLAYER_FORMATS = ['recall', 'reference', 'missing-point'] as const;
export const RETIRED_FORMATS = ['difference', 'ratio', 'ranking', 'trajectory'] as const;
export const FORMATS = [...PLAYER_FORMATS, ...RETIRED_FORMATS] as const;
export type QuestionFormat = (typeof FORMATS)[number];
export type PlayerFormat = (typeof PLAYER_FORMATS)[number];
export const TAXONOMY_VERSION = 2;
export const isPlayerFormat = (f: unknown): f is PlayerFormat => typeof f === 'string' && (PLAYER_FORMATS as readonly string[]).includes(f);

const text = (min: number, max: number) => z.string().check(z.minLength(min), z.maxLength(max));

/** One bar of a missing-point chart. `value` is null for the hidden observation only. */
export const ChartPointSchema = z.object({
  label: text(1, 14),
  value: z.nullable(z.number()),
});

export const QuestionChartSchema = z.object({
  /** What the bars measure, in plain words ("Regular-season wins"). */
  title: text(3, 48),
  /** Short unit for the bar values ("wins", "ppg", "%"). */
  unit: text(1, 16),
  points: z.array(ChartPointSchema).check(z.minLength(3), z.maxLength(7)),
});

/**
 * Structured classification for every V5 question (and the future Scouting
 * Report). Generated from the fact database, never guessed from prompt text.
 */
export const QuestionMetaSchema = z.object({
  format: z.enum(FORMATS),
  /** Stat family id from data/nba/families.json. */
  family: text(2, 40),
  /** Decade of the season ("1990s"), or "timeless" for rules and cross-era questions. */
  era: text(4, 12),
  /** Players and franchises the question is about, most specific first. */
  subjects: z.array(text(2, 60)).check(z.maxLength(4)),
  /** Verified fact ids the prompt, chart or derivation uses besides the question's own. */
  supports: z.array(z.string().check(z.regex(/^[a-z0-9-]+$/))).check(z.maxLength(7)),
});

export type QuestionChart = z.infer<typeof QuestionChartSchema>;
export type QuestionMeta = z.infer<typeof QuestionMetaSchema>;

/** Format of a played question: anything published before V5 is plain recall. */
export const formatOf = (q: { meta?: QuestionMeta | undefined }): QuestionFormat => q.meta?.format ?? 'recall';

/**
 * V5.2 daily distribution rule. From this canonical day on, every official five-question
 * slate uses all three player formats in a 2/2/1 distribution: two of one, two of
 * another, one of the third. Which format appears once, and the round positions, rotate
 * from day to day (`sequenceIssues` refuses identical consecutive sequences). The format
 * is the question's single primary player-facing task (`meta.format`); subjects, eras
 * and stat families never count toward this rule.
 *
 * It is the first day the restarted official season can begin (docs/LAUNCH.md), so
 * every official slate is covered. Earlier days are published beta content whose
 * bytes and lock fingerprints never change.
 */
export const VARIETY_FROM = '2026-11-30';
export const MAX_PER_FORMAT = 2;

/**
 * Problems with one official slate's format mix. `formats` holds each question's
 * canonical format, or `undefined`/an unknown string when the metadata is missing,
 * which is itself an error: the distribution cannot be proven without it.
 */
export function slateFormatIssues(formats: readonly (string | undefined)[]): string[] {
  const issues: string[] = [];
  if (formats.length !== 5) issues.push(`has ${formats.length} questions; an official slate has 5`);
  const counts = new Map<PlayerFormat, number>(PLAYER_FORMATS.map((f) => [f, 0]));
  formats.forEach((f, i) => {
    if (f === undefined) issues.push(`Q${i + 1} has no format metadata`);
    else if ((RETIRED_FORMATS as readonly string[]).includes(f)) issues.push(`Q${i + 1} uses the retired ${f} format`);
    else if (!isPlayerFormat(f)) issues.push(`Q${i + 1} has unknown format ${f}`);
    else counts.set(f, counts.get(f)! + 1);
  });
  if (issues.length) return issues;
  for (const [f, n] of counts) {
    if (n > MAX_PER_FORMAT) issues.push(`${n} ${f} questions (2/2/1 allows at most 2)`);
    if (n === 0) issues.push(`no ${f} question (every official day uses all three formats)`);
  }
  return issues;
}

/** Consecutive official days must not repeat the exact same format sequence. */
export function sequenceIssues(days: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < days.length; i++)
    if (days[i]!.join('|') === days[i - 1]!.join('|')) out.push(`day ${i + 1} repeats the format sequence of day ${i}`);
  return out;
}

/** The distribution as a sorted pattern ("2+2+1"), for reports. */
export function formatPattern(formats: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of formats) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.values()].sort((a, b) => b - a).join('+');
}
