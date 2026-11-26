import { describe, expect, it } from 'vitest';
import { FORMATS, formatPattern, slateFormatIssues } from './formats';

const R = 'recall', F = 'reference', M = 'missing-point', D = 'difference', P = 'ratio';

describe('daily format variety (max two per format, at least three formats)', () => {
  it.each([
    ['2+2+1', [R, R, F, F, M]],
    ['2+1+1+1', [R, F, R, M, D]],
    ['1+1+1+1+1', [R, F, M, D, P]],
  ])('accepts %s', (pattern, formats) => {
    expect(slateFormatIssues(formats)).toEqual([]);
    expect(formatPattern(formats)).toBe(pattern);
  });

  it.each([
    ['5', [R, R, R, R, R]],
    ['4+1', [R, R, F, R, R]],
    ['3+2', [R, F, R, F, R]],
    ['3+1+1', [F, F, M, F, R]],
  ])('rejects %s', (pattern, formats) => {
    expect(formatPattern(formats)).toBe(pattern);
    expect(slateFormatIssues(formats).length).toBeGreaterThan(0);
  });

  it('a 2+2+1 slate is the smallest legal mix: a 2+2 four-question slate is not a slate', () => {
    expect(slateFormatIssues([R, R, F, F])).toContain('has 4 questions; an official slate has 5');
  });

  it('rejects missing or unknown format metadata instead of guessing recall', () => {
    expect(slateFormatIssues([R, undefined, F, M, D])).toEqual(['Q2 has no format metadata']);
    expect(slateFormatIssues([R, 'trivia', F, M, D])).toEqual(['Q2 has unknown format trivia']);
  });

  it('every canonical format can appear in a legal slate', () => {
    for (const f of FORMATS) {
      const others = FORMATS.filter((x) => x !== f).slice(0, 3);
      expect(slateFormatIssues([f, f, ...others])).toEqual([]);
    }
  });
});
