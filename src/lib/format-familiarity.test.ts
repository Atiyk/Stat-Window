import { describe, expect, it } from 'vitest';
import { FAMILIARITY_KEY, markFormatSeen, seenFormats } from './format-familiarity';
import { SAVE_KEY } from '../engine/storage';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('format familiarity', () => {
  it('records each format once, in its own key outside the official save', () => {
    const s = memory();
    expect(seenFormats(s).size).toBe(0);
    markFormatSeen('ratio', s);
    markFormatSeen('ratio', s);
    markFormatSeen('missing-point', s);
    expect([...seenFormats(s)].sort()).toEqual(['missing-point', 'ratio']);
    expect(FAMILIARITY_KEY).not.toBe(SAVE_KEY);
    expect([...s.data.keys()]).toEqual([FAMILIARITY_KEY]);
  });

  it('ignores corrupt or unknown values', () => {
    const s = memory();
    s.setItem(FAMILIARITY_KEY, '{nope');
    expect(seenFormats(s).size).toBe(0);
    s.setItem(FAMILIARITY_KEY, JSON.stringify(['ratio', 'vibes', 3]));
    expect([...seenFormats(s)]).toEqual(['ratio']);
  });

  it('survives blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(seenFormats(blocked).size).toBe(0);
    expect(() => markFormatSeen('ranking', blocked)).not.toThrow();
  });
});
