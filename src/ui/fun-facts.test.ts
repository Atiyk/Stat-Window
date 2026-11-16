import { describe, expect, it } from 'vitest';
import { funFactIndex, pickFunFact } from './fun-facts';

const variants = [
  { text: 'The game was played in an old hockey arena.', source: { name: 'Example', url: 'https://example.com/one', quote: 'hockey arena evidence' } },
  { text: 'The game was not televised.', source: { name: 'Example', url: 'https://example.com/two', quote: 'televised evidence' } },
  { text: 'The teams changed their late-game foul strategy.', source: { name: 'Example', url: 'https://example.com/three', quote: 'foul strategy evidence' } },
];

describe('fun fact rotation', () => {
  it('stays on the same variant for the same browser and question', () => {
    const idx = funFactIndex('nba-wilt-100', 3, 'browser-123');
    expect(funFactIndex('nba-wilt-100', 3, 'browser-123')).toBe(idx);
    expect(pickFunFact({ id: 'nba-wilt-100', funFacts: variants }, 'browser-123')).toBe(variants[idx]);
  });
  it('can serve all three variants across different browser seeds', () => {
    const selected = new Set(Array.from({ length: 150 }, (_, n) => funFactIndex('nba-wilt-100', 3, `visitor-${n}`)));
    expect([...selected].sort()).toEqual([0, 1, 2]);
  });
  it('does not invent a fact when none has been reviewed', () => {
    expect(pickFunFact({ id: 'nba-other' }, 'abc')).toBeNull();
    expect(funFactIndex('nba-other', 0, 'abc')).toBe(-1);
  });
});
