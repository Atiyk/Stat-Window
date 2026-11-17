import { describe, expect, it } from 'vitest';
import { auditFunFacts } from './fun-fact-audit';
import type { Slate } from './schema';

const sample = (text: string) => ({
  text,
  source: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Example', quote: 'Evidence confirming the claim.' },
});
const fixture = (hint: string): Slate => ({
  date: '2027-01-01',
  questions: [
    { id: 'first', answer: 52, step: 1, funFacts: [sample(hint), sample('Second detail about an old stadium.'), sample('Third detail about a historic broadcast.')] },
    { id: 'second', answer: 28, step: 1 },
    { id: 'third', answer: 400, step: 1 },
    { id: 'fourth', answer: 17, step: 1 },
    { id: 'fifth', answer: 900, step: 1 },
  ],
} as unknown as Slate);

describe('editorial trivia audit', () => {
  it('counts only complete sets and records unreviewed questions', () => {
    const r = auditFunFacts([fixture('A historic game featured an unusual halftime interview.')]);
    expect(r.totalQuestions).toBe(5);
    expect(r.coveredQuestions).toBe(1);
    expect(r.verifiedVariants).toBe(3);
    expect(r.missingQuestionIds).toHaveLength(4);
    expect(r.errors).toEqual([]);
  });
  it('detects a numeric answer accidentally revealed before its round', () => {
    const r = auditFunFacts([fixture('The next player scored 28 points during the game.')]);
    expect(r.errors.join(' ')).toMatch(/may spoil later question second/);
  });
  it('ignores a number embedded inside a different number', () => {
    const r = auditFunFacts([fixture('The arena once held 2028 spectators in a test event.')]);
    expect(r.errors).toEqual([]);
  });
});
