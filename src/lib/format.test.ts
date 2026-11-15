import { describe, expect, it } from 'vitest';
import { niceTicks } from './format';

describe('niceTicks', () => {
  it('labels round values across the scale', () => {
    expect(niceTicks(0, 100, 5).major).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('labels the low end when no round value sits near it', () => {
    // A 20–200 scale would otherwise start its labels at 50.
    expect(niceTicks(20, 200, 5).major[0]).toBe(20);
  });

  it('labels the high end when no round value sits near it', () => {
    expect(niceTicks(0, 230, 5).major.at(-1)).toBe(230);
  });

  it('does not crowd an end label against a round value', () => {
    expect(niceTicks(14, 100, 5).major[0]).toBe(20);
  });
});
