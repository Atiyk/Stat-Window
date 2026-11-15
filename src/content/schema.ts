import { z } from 'zod';
import { addDays } from '../engine/daily.ts';
import { stepDecimals } from '../engine/scoring.ts';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

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

export const QuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'Lowercase id with dashes'),
    sport: z.string().min(2),
    prompt: z.string().min(10).max(140),
    context: z.string().min(3).max(80),
    answer: z.number().finite(),
    unit: z.object({ singular: z.string().min(1), plural: z.string().min(1) }),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive(),
    note: z.string().min(3).max(140),
    source: z.object({
      name: z.string().min(2),
      url: z.url({ protocol: /^https$/ }),
      quote: z.string().min(3).max(160),
      /** When the page states the figure another way (11 h 5 min), show the arithmetic. */
      derivation: z.string().optional(),
    }),
    verified: z.object({ on: isoDay, by: z.string().min(2) }),
  })
  .superRefine((q, ctx) => {
    if (!(q.min < q.answer && q.answer < q.max)) {
      ctx.addIssue({ code: 'custom', message: `${q.id}: answer must sit strictly inside min and max` });
    }
    const steps = (q.max - q.min) / q.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9 || Math.round(steps) < 5) {
      ctx.addIssue({ code: 'custom', message: `${q.id}: range must be a whole number of steps (at least 5)` });
    }
    if (Math.round(steps) > 400) {
      ctx.addIssue({ code: 'custom', message: `${q.id}: more than 400 steps is too fine to drag; raise the step` });
    }
    const hasFigure = answerSpellings(q.answer, q.step).some((s) =>
      q.source.quote.toLowerCase().includes(s.toLowerCase()),
    );
    if (!hasFigure && !q.source.derivation) {
      ctx.addIssue({ code: 'custom', message: `${q.id}: source quote must contain the answer, or give a derivation` });
    }
  });

export const SlateSchema = z.object({
  date: isoDay,
  questions: z.array(QuestionSchema).length(5),
});

export type Question = z.infer<typeof QuestionSchema>;
export type Slate = z.infer<typeof SlateSchema>;

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
