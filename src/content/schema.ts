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

export const SlateSchema = z.object({
  date: isoDay,
  questions: z.array(QuestionSchema).check(z.length(5)),
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
  const upcoming = sorted.filter((s) => s.date > today).flatMap((s) => s.questions);
  if (upcoming.length >= 10) {
    const pos = upcoming.map((q) => (q.answer - q.min) / (q.max - q.min));
    const mean = pos.reduce((x, y) => x + y, 0) / pos.length;
    const banded = pos.filter((p) => Math.abs(p - mean) <= 0.15).length / pos.length;
    if (mean < 0.35 || mean > 0.65 || banded > 0.8) {
      warnings.push(
        `Upcoming answers cluster on the ruler (average ${Math.round(mean * 100)}% along, ${Math.round(banded * 100)}% within 15 points of it); vary min/max so placement gives nothing away`,
      );
    }
  }
  return { errors, warnings, firstDay: sorted[0]?.date, lastDay: sorted.at(-1)?.date };
}

/**
 * Published-content lock. Saved scores and share links depend on each question's
 * id, answer, scale and order, so once a day has been published these must never
 * change. content/published.lock.json records them; text (prompt, note, source)
 * may still be corrected without touching the lock.
 */
export type ContentLock = Record<string, string[]>;

export function scoringFingerprint(slate: Slate): string[] {
  return slate.questions.map((q) => `${q.id}|${q.answer}|${q.min}|${q.max}|${q.step}`);
}

/** Errors when a day on or before `today` differs from the lock (or is missing from it); warns for later days. */
export function checkLock(slates: readonly Slate[], lock: ContentLock, today: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const present = new Set(slates.map((s) => s.date));
  for (const day of Object.keys(lock)) {
    if (day <= today && !present.has(day)) errors.push(`${day} is published but its file is missing; restore content/days/${day}.json`);
  }
  for (const s of slates) {
    const want = lock[s.date];
    const have = scoringFingerprint(s);
    const same = want !== undefined && want.length === have.length && want.every((v, i) => v === have[i]);
    if (same) continue;
    if (s.date <= today) {
      errors.push(
        want === undefined
          ? `${s.date} is published but not in content/published.lock.json; run npm run content:lock`
          : `${s.date} is published: question ids, answers, scales and order are locked (${have.find((v, i) => v !== want[i]) ?? 'length'} differs)`,
      );
    } else {
      warnings.push(`${s.date} changed since it was locked; run npm run content:lock after checking it`);
    }
  }
  return { errors, warnings };
}

export function runwayDays(slates: readonly Slate[], today: string): number {
  return slates.filter((s) => s.date >= today).length;
}
