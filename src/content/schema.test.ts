import { describe, expect, it } from 'vitest';
import { checkInventory, parseSlate, checkLock, scoringFingerprint, type Slate } from './schema';

const good = {
  id: 'nba-test',
  sport: 'Basketball',
  prompt: 'How many games did they win?',
  context: 'NBA · 2016',
  answer: 73,
  unit: { singular: 'win', plural: 'wins' },
  min: 40,
  max: 82,
  step: 1,
  note: 'A note.',
  source: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/X', quote: 'record of 73–9' },
  verified: { on: '2026-11-15', by: 'Editor' },
};
const slate = (date: string, idPrefix: string) => ({
  date,
  questions: [1, 2, 3, 4, 5].map((n) => ({ ...good, id: `${idPrefix}-${n}` })),
});

describe('parseSlate', () => {
  it('accepts a well-formed slate', () => {
    expect(parseSlate(slate('2026-11-15', 'a')).questions).toHaveLength(5);
  });
  it('rejects a slate without exactly five questions', () => {
    const s = slate('2026-11-15', 'a');
    expect(() => parseSlate({ ...s, questions: s.questions.slice(0, 4) })).toThrow();
  });
  it('rejects an answer sitting on or outside the bounds', () => {
    const s = slate('2026-11-15', 'a');
    s.questions[0] = { ...good, id: 'x', answer: 40 };
    expect(() => parseSlate(s)).toThrow(/strictly inside/);
  });
  it('rejects a range that is not a whole number of steps', () => {
    const s = slate('2026-11-15', 'a');
    s.questions[0] = { ...good, id: 'x', min: 0, max: 105, step: 10 };
    expect(() => parseSlate(s)).toThrow(/whole number of steps/);
  });
  it('rejects a source that is not https', () => {
    const s = slate('2026-11-15', 'a');
    s.questions[0] = { ...good, id: 'x', source: { ...good.source, url: 'http://example.com' } };
    expect(() => parseSlate(s)).toThrow();
  });
  it('rejects a source quote that does not contain the answer figure', () => {
    const s = slate('2026-11-15', 'a');
    s.questions[0] = { ...good, id: 'x', source: { ...good.source, quote: 'a great season' } };
    expect(() => parseSlate(s)).toThrow(/quote/);
  });
});

describe('checkInventory', () => {
  it('reports duplicate question ids across days', () => {
    const r = checkInventory([slate('2026-11-15', 'a'), slate('2026-11-16', 'a')], '2026-11-15');
    expect(r.errors.join(' ')).toMatch(/duplicate/i);
  });
  it('reports gaps between days', () => {
    const r = checkInventory([slate('2026-11-15', 'a'), slate('2026-11-17', 'b')], '2026-11-15');
    expect(r.errors.join(' ')).toMatch(/gap/i);
  });
  it('warns when fewer than seven days remain from today', () => {
    const r = checkInventory([slate('2026-11-15', 'a'), slate('2026-11-16', 'b')], '2026-11-15');
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/2 day/);
  });
});

describe('published-content lock', () => {
  const slate = (date: string, answer = 73): Slate =>
    ({ date, questions: [1, 2, 3, 4, 5].map((i) => ({ id: `q${date}${i}`, answer, min: 0, max: 100, step: 1 })) }) as unknown as Slate;
  it('passes when published days match the lock', () => {
    const s = slate('2026-11-15');
    expect(checkLock([s], { '2026-11-15': scoringFingerprint(s) }, '2026-11-16')).toEqual({ errors: [], warnings: [] });
  });
  it('blocks any change to the answer or scale of a published day', () => {
    const lock = { '2026-11-15': scoringFingerprint(slate('2026-11-15')) };
    expect(checkLock([slate('2026-11-15', 74)], lock, '2026-11-16').errors).toHaveLength(1);
  });
  it('only warns for a change to a day that is not out yet', () => {
    const lock = { '2026-11-20': scoringFingerprint(slate('2026-11-20')) };
    const r = checkLock([slate('2026-11-20', 74)], lock, '2026-11-16');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
  it('requires a published day to be locked at all', () => {
    expect(checkLock([slate('2026-11-15')], {}, '2026-11-15').errors).toHaveLength(1);
  });
});
