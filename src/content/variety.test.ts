import { describe, expect, it } from 'vitest';
import { FORMATS, PLAYER_FORMATS, RETIRED_FORMATS, formatPattern, isPlayerFormat, sequenceIssues, slateFormatIssues } from './formats';

const R = 'recall', F = 'reference', M = 'missing-point', D = 'difference', P = 'ratio';

describe('V5.2 taxonomy: three player-facing formats', () => {
  it('has exactly recall, reference and missing-point as player formats', () => {
    expect([...PLAYER_FORMATS]).toEqual([R, F, M]);
  });
  it('keeps the retired V5/V5.1 formats readable for historical records', () => {
    expect([...RETIRED_FORMATS].sort()).toEqual(['difference', 'ranking', 'ratio', 'trajectory']);
    for (const f of RETIRED_FORMATS) {
      expect((FORMATS as readonly string[]).includes(f)).toBe(true);
      expect(isPlayerFormat(f)).toBe(false);
    }
  });
});

describe('daily 2/2/1 distribution (every official slate)', () => {
  it.each([
    [[R, R, F, F, M]],
    [[M, F, R, F, M]],
    [[F, R, M, R, M]],
  ])('accepts %j', (formats) => {
    expect(slateFormatIssues(formats)).toEqual([]);
    expect(formatPattern(formats)).toBe('2+2+1');
  });

  it.each([
    ['5', [R, R, R, R, R]],
    ['4+1', [R, R, F, R, R]],
    ['3+2', [R, F, R, F, R]],
    ['3+1+1', [F, F, M, F, R]],
  ])('rejects %s', (_p, formats) => {
    expect(slateFormatIssues(formats).length).toBeGreaterThan(0);
  });

  it('rejects a slate that leaves out one of the three formats', () => {
    expect(slateFormatIssues([R, R, F, F, F])).toContain('3 reference questions (2/2/1 allows at most 2)');
    expect(slateFormatIssues([R, R, F, F, R]).some((i) => i.includes('missing-point'))).toBe(true);
  });

  it('rejects retired formats in an official slate', () => {
    expect(slateFormatIssues([R, F, M, D, R])).toContain('Q4 uses the retired difference format');
    expect(slateFormatIssues([R, F, M, F, P])).toContain('Q5 uses the retired ratio format');
  });

  it('rejects a four-question slate', () => {
    expect(slateFormatIssues([R, R, F, M])).toContain('has 4 questions; an official slate has 5');
  });

  it('rejects missing or unknown format metadata instead of guessing recall', () => {
    expect(slateFormatIssues([R, undefined, F, M, M])).toEqual(['Q2 has no format metadata']);
    expect(slateFormatIssues([R, 'trivia', F, M, M])).toEqual(['Q2 has unknown format trivia']);
  });
});

describe('sequence variety across consecutive days', () => {
  it('rejects two consecutive days with the identical format sequence', () => {
    const day = [R, F, M, F, R];
    expect(sequenceIssues([day, day])).toEqual(['day 2 repeats the format sequence of day 1']);
  });
  it('accepts the same pattern in different positions', () => {
    expect(sequenceIssues([[R, F, M, F, R], [F, R, M, R, F]])).toEqual([]);
  });
});
