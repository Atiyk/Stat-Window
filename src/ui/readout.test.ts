import { describe, expect, it } from 'vitest';
import { keyboardFor, parseTyped } from './Readout';

describe('typing an exact bracket value', () => {
  it('reads plain and grouped whole numbers', () => {
    expect(parseTyped('73', 1)).toBe(73);
    expect(parseTyped(' 1,250 ', 1)).toBe(1250);
    expect(parseTyped('12 500', 1)).toBe(12500);
  });

  it('reads a decimal point, and a decimal comma on a decimal scale', () => {
    expect(parseTyped('27.4', 0.1)).toBe(27.4);
    expect(parseTyped('27,4', 0.1)).toBe(27.4);
    expect(parseTyped('.5', 0.1)).toBe(0.5);
  });

  it('keeps a comma as a thousands separator on whole-number scales', () => {
    expect(parseTyped('1,250', 1)).toBe(1250);
  });

  it('rejects empty or non-numeric text', () => {
    expect(parseTyped('', 1)).toBeNull();
    expect(parseTyped('  ', 0.1)).toBeNull();
    expect(parseTyped('abc', 1)).toBeNull();
    expect(parseTyped('1.2.3', 0.1)).toBeNull();
  });

  it('asks phones for a decimal keypad only when the scale needs one', () => {
    expect(keyboardFor({ step: 1, min: 0 })).toBe('numeric');
    expect(keyboardFor({ step: 0.1, min: 0 })).toBe('decimal');
    expect(keyboardFor({ step: 1, min: -10 })).toBe('text');
  });
});
