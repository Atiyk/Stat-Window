import * as z from 'zod/mini';
import { addDays } from '../engine/daily.ts';
import { stepDecimals } from '../engine/scoring.ts';

const isoDay = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'));

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

/** Every way a source might print the answer: 2632, 2,632, 8.90, "seven". */
export function answerSpellings(answer: number, step: number): string[] {
  const fixed = answer.toFixed(stepDecimals(step));
  const grouped = Number(answer).toLocaleString('en-US', {
    minimumFractionDigits: stepDecimals(step),
    maximumFractionDigits: stepDecimals(step),
  });
  const words = Number.isInteger(answer) && answer <= 20 ? [NUMBER_WORDS[answer] ?? ''] : [];
  return [...new Set([fixed, grouped, ...words].filter(Boolean))];
}

const text = (min: number, max = 2000) => z.string().check(z.minLength(min), z.maxLength(max));

export const QuestionSchema = z
  .object({
    id: z.string().check(z.regex(/^[a-z0-9-]+$/, 'Lowercase id with dashes')),
    sport: text(2),
    prompt: text(10, 140),
    context: text(3, 80),
    answer: z.number(),
    unit: z.object({ singular: text(1), plural: text(1) }),
    min: z.number(),
    max: z.number(),
    step: z.number().check(z.positive()),
    note: text(3, 140),
    source: z.object({
      name: text(2),
      url: z.url({ protocol: /^https$/ }),
      quote: text(3, 160),
      /** When the page states the figure another way (11 h 5 min), show the arithmetic. */
      derivation: z.optional(z.string()),
    }),
    verified: z.object({ on: isoDay, by: text(2) }),
    /** NBA days climb easy → medium → hard → hard → expert. Older days have no label. */
    difficulty: z.optional(z.enum(['easy', 'medium', 'hard', 'expert'])),
  })
  .check(
    z.superRefine((q, ctx) => {
      if (!(q.min < q.answer && q.answer < q.max)) {
        ctx.issues.push({ code: 'custom', input: q, message: `${q.id}: answer must sit strictly inside min and max` });
      }
      const steps = (q.max - q.min) / q.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9 || Math.round(steps) < 5) {
        ctx.issues.push({ code: 'custom', input: q, message: `${q.id}: range must be a whole number of steps (at least 5)` });
      }
      if (Math.round(steps) > 400) {
        ctx.issues.push({ code: 'custom', input: q, message: `${q.id}: more than 400 steps is too fine to drag; raise the step` });
      }
      const hasFigure = answerSpellings(q.answer, q.step).some((s) =>
        q.source.quote.toLowerCase().includes(s.toLowerCase()),
      );
      if (!hasFigure && !q.source.derivation) {
        ctx.issues.push({ code: 'custom', input: q, message: `${q.id}: source quote must contain the answer, or give a derivation` });
      }
    }),
  );

export const ThemeSchema = z.object({
  title: text(2, 40),
  subtitle: text(2, 60),
  recap: text(10, 220),
});

export const SlateSchema = z.object({
  date: isoDay,
  /** Themed days (from the NBA cutover on) carry a title, a subtitle and a post-game recap. */
  theme: z.optional(ThemeSchema),
  questions: z.array(QuestionSchema).check(z.length(5)),
});

export type Question = z.infer<typeof QuestionSchema>;
export type Slate = z.infer<typeof SlateSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Difficulty = NonNullable<Question['difficulty']>;

export function parseSlate(input: unknown): Slate {
  return SlateSchema.parse(input);
}

export type InventoryReport = {
  readonly errors: string[];
  readonly warnings: string[];
  readonly firstDay: string | undefined;
  readonly lastDay: string | undefined;
};

export const RUNWAY_DAYS = 7;

/** Cross-slate checks: unique ids, consecutive days, enough runway ahead of `today`. */
export function checkInventory(slates: readonly Slate[], today: string): InventoryReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sorted = [...slates].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Map<string, string>();
  sorted.forEach((s, i) => {
    for (const q of s.questions) {
      const prev = seen.get(q.id);
      if (prev) errors.push(`Duplicate question id ${q.id} on ${prev} and ${s.date}`);
      seen.set(q.id, s.date);
    }
    const next = sorted[i + 1];
    if (next && addDays(s.date, 1) !== next.date) errors.push(`Gap between ${s.date} and ${next.date}`);
    if (next && next.date === s.date) errors.push(`Two slates for ${s.date}`);
  });
  const ahead = sorted.filter((s) => s.date >= today).length;
  if (ahead < RUNWAY_DAYS) {
    warnings.push(`Only ${ahead} day${ahead === 1 ? '' : 's'} of puzzles left from ${today}; publish more`);
  }
  return { errors, warnings, firstDay: sorted[0]?.date, lastDay: sorted.at(-1)?.date };
}
