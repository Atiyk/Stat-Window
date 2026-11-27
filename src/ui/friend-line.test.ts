import { describe, expect, it } from 'vitest';
import { friendLine } from './Results';

describe('friendLine', () => {
  it('says "1 point" for a one-point margin either way', () => {
    expect(friendLine(101, 100, null, null)).toBe('You beat your friend by 1 point.');
    expect(friendLine(100, 101, null, null)).toBe('Your friend leads by 1 point. Send a rematch.');
  });
  it('keeps "points" for larger margins', () => {
    expect(friendLine(150, 100, null, null)).toBe('You beat your friend by 50 points.');
    expect(friendLine(44, 100, null, null)).toBe('Your friend leads by 56 points. Send a rematch.');
  });
});
