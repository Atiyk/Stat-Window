import * as z from 'zod/mini';

/**
 * V5 question formats. Every format is answered with the same brackets, scored by
 * the same formula, on the same 24-second clock: a format only changes what the
 * player is shown before the lock and how the reveal explains the answer.
 *
 * - `recall`: a verified number on its own (every question before V5).
 * - `reference`: the prompt gives a related verified figure to reason from.
 * - `missing-point`: a small chart of verified observations with one gap; the gap
 *   is the answer and fills in on reveal.
 * - `difference`: the gap between two verified figures; direction and unit are in
 *   the prompt.
 * - `ratio`: a percentage or share computed from two verified figures.
 * - `ranking`: an objective rank or threshold count stated by the source.
 * - `trajectory`: a change across seasons or career stages.
 */
export const FORMATS = ['recall', 'reference', 'missing-point', 'difference', 'ratio', 'ranking', 'trajectory'] as const;
export type QuestionFormat = (typeof FORMATS)[number];

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
