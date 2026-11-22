import { describe, expect, it } from 'vitest';
import { middleNeedsReview, type MiddleRatings } from './editorial-ratings';

describe('NBA middle-round engagement inventory', () => {
  it('flags an uninteresting, unrecognizable or unestimable question individually', () => {
    for (const key of ['interest','recognizability','estimability'] as const) {
      const r: MiddleRatings = { interest: 3, recognizability: 3, estimability: 3 };
      r[key] = 2;
      expect(middleNeedsReview(r)).toBe(true);
    }
  });
  it('keeps ordinary well-bounded questions unflagged; never edits subjective ratings', () => {
    const r: MiddleRatings = Object.freeze({ interest: 3, recognizability: 4, estimability: 3 });
    expect(middleNeedsReview(r)).toBe(false);
    expect(r).toEqual({ interest: 3, recognizability: 4, estimability: 3 });
  });
  it('is an attention flag, not an automatic source or scoring verdict', () => {
    expect(middleNeedsReview({ interest: 4, recognizability: 5, estimability: 2 })).toBe(true);
    expect(middleNeedsReview({ interest: 5, recognizability: 5, estimability: 5 })).toBe(false);
  });
});
