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

/** Minimal metadata for cross-checks against unpublished Survival reserve answers. */
export type NBAContext = {
  id: string;
  player: string | null;
  franchise: string | null;
  season: string | null;
  answer: number;
  step: number;
};

/**
 * Trivia must never disclose a related, still-unplayed reserve question's answer.
 * Exact numeric tokens avoid false positives such as 14 in a year like 2014.
 */
export function auditReserveSpoilers(
  slates: readonly Slate[],
  byId: ReadonlyMap<string, NBAContext>,
  reserves: readonly NBAContext[],
): string[] {
  const errors: string[] = [];
  for (const slate of slates) for (const question of slate.questions) {
    const current = byId.get(question.id);
    if (!current || !question.funFacts) continue;
    for (const [index, trivia] of question.funFacts.entries()) for (const candidate of reserves) {
      const samePlayer = !!current.player && current.player === candidate.player;
      const sameTeamSeason =
        !!current.franchise && current.franchise === candidate.franchise &&
        !!current.season && current.season === candidate.season;
      if (!samePlayer && !sameTeamSeason) continue;
      const numerals = answerSpellings(candidate.answer, candidate.step).filter((v) => /\d/.test(v));
      if (numerals.some((n) => containsNumericAnswer(trivia.text, n)))
        errors.push(`${slate.date}:${question.id}#${index + 1}: may disclose reserve ${candidate.id} (${candidate.answer})`);
    }
  }
  return errors;
}
