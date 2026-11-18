import { describe, expect, it } from 'vitest';
import { auditFunFacts, auditReserveSpoilers, type NBAContext } from './fun-fact-audit';
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

describe('unpublished Survival reserve protection', () => {
  const base: NBAContext = { id: 'nba-wilt-100', player: 'Wilt Chamberlain', franchise: 'GSW', season: '1961-62', answer: 100, step: 1 };
  const reserve: NBAContext = { id: 'nba-wilt62-total-points', player: 'Wilt Chamberlain', franchise: 'GSW', season: '1961-62', answer: 4029, step: 1 };
  const first = fixture('Wilt scored 4,029 points in that season.');
  first.questions[0]!.id = base.id;
  it('rejects reserve-answer giveaways for a related NBA question', () => {
    expect(auditReserveSpoilers([first], new Map([[base.id, base]]), [reserve]).join(' ')).toMatch(/reserve nba-wilt62-total-points/);
  });
  it('accepts a fun fact that does not reveal an unpublished answer', () => {
    first.questions[0]!.funFacts![0]!.text = 'The coach wanted Chamberlain to play every minute of every game.';
    expect(auditReserveSpoilers([first], new Map([[base.id, base]]), [reserve])).toEqual([]);
  });
  it('does not flag a number embedded in a different figure', () => {
    first.questions[0]!.funFacts![0]!.text = 'A fan saw the game in 14029 seconds on a video.';
    expect(auditReserveSpoilers([first], new Map([[base.id, base]]), [reserve])).toEqual([]);
  });
});
