import type { Question, Slate } from '../content/schema';
import { normalizeWindow, type RoundRecord } from './game';
import { scoreWindow } from './scoring';
import type { SavedRun } from './storage';

type Meta = NonNullable<Question['meta']>;

/** A five-question test slate on a 0–100 scale (answer 73), optionally with V5 metadata per question. */
export function testSlate(date: string, metas: readonly (Partial<Meta> | undefined)[] = []): Slate {
  return {
    date,
    questions: Array.from({ length: 5 }, (_, index): Question => {
      const m = metas[index];
      return {
        id: `${date}-${index}`,
        sport: 'NBA',
        prompt: 'How many points?',
        context: 'Test slate',
        answer: 73,
        unit: { singular: 'point', plural: 'points' },
        min: 0,
        max: 100,
        step: 1,
        note: 'Test answer',
        source: { name: 'Test source', quote: '73 points', url: 'https://example.com' },
        verified: { on: '2026-11-15', by: 'Test' },
        ...(m ? { meta: { format: 'recall', family: 'points-game', era: '2010s', subjects: [], supports: [], ...m } as Meta } : {}),
      };
    }),
  };
}

export type Pick = [lo: number, hi: number] | 'timeout';

/** A finished official run whose windows are exactly `picks`, scored by the real rules. */
export function testRun(slate: Slate, picks: readonly Pick[] = Array(5).fill([63, 83])): SavedRun {
  const results = slate.questions.map((question, i): RoundRecord => {
    const pick = picks[i] ?? [63, 83];
    if (pick === 'timeout') {
      return { questionId: question.id, lo: question.min, hi: question.max, hit: false, points: 0, missBy: 0, timedOut: true };
    }
    const window = normalizeWindow(question, { lo: pick[0], hi: pick[1] });
    return { questionId: question.id, ...window, ...scoreWindow(question, window) };
  });
  return { results, advanced: 5 };
}
