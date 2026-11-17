import { answerSpellings, type Slate } from './schema.ts';

export type TriviaAudit = {
  totalQuestions: number;
  coveredQuestions: number;
  verifiedVariants: number;
  missingQuestionIds: string[];
  errors: string[];
};

/** Whole-number tokens only: '28' shouldn't match 2028 or 28.5. */
function containsNumericAnswer(text: string, numeric: string): boolean {
  const escaped = numeric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\d.,])${escaped}(?![\\d]|[.,]\\d)`).test(text);
}

/** Editorial checks independent of scoring and published content locks. */
export function auditFunFacts(slates: readonly Slate[]): TriviaAudit {
  let totalQuestions = 0;
  let coveredQuestions = 0;
  let verifiedVariants = 0;
  const missingQuestionIds: string[] = [];
  const errors: string[] = [];
  for (const slate of slates) {
    const textSeen = new Set<string>();
    for (const [i, question] of slate.questions.entries()) {
      totalQuestions++;
      const variants = question.funFacts;
      if (!variants) {
        missingQuestionIds.push(`${slate.date}:${question.id}`);
        continue;
      }
      if (variants.length !== 3) {
        errors.push(`${slate.date}:${question.id} needs exactly 3 variants`);
        continue;
      }
      coveredQuestions++;
      verifiedVariants += variants.length;
      for (const [index, variant] of variants.entries()) {
        const id = `${slate.date}:${question.id}#${index+1}`;
        const norm = variant.text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (textSeen.has(norm)) errors.push(`${id}: repeated text within a day`);
        textSeen.add(norm);
        if (variant.source.quote.trim().length < 10) errors.push(`${id}: missing evidence quote`);
        if (!variant.source.url.startsWith('https://')) errors.push(`${id}: source is not HTTPS`);
        for (const later of slate.questions.slice(i+1)) {
          // Ignore word spellings: e.g., 'seven' is a normal part of a sports story.
          const numberForms = answerSpellings(later.answer, later.step).filter((x) => /\d/.test(x));
          if (numberForms.some((a) => containsNumericAnswer(variant.text, a))) {
            errors.push(`${id}: may spoil later question ${later.id} (answer ${later.answer})`);
          }
        }
      }
    }
  }
  return { totalQuestions, coveredQuestions, verifiedVariants, missingQuestionIds, errors };
}
