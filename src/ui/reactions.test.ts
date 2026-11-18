import { describe, expect, it } from 'vitest';
import { REACTIONS, classifyReaction, pickReaction, pickReactions, type ReactionInput, type ReactionSituation } from './reactions';

// Ruler 0..100, step 1, round 2 of 5 unless overridden.
const base: ReactionInput = { hit: true, points: 50, missBy: 0, lo: 40, hi: 60, min: 0, max: 100, step: 1, round: 1 };
const hit = (points: number, extra: Partial<ReactionInput> = {}): ReactionInput => ({ ...base, hit: true, points, missBy: 0, ...extra });
const miss = (missBy: number, extra: Partial<ReactionInput> = {}): ReactionInput => ({
  ...base, hit: false, points: 0, missBy, lo: 40, hi: 42, ...extra,
});

const allLines = Object.values(REACTIONS).flat();

describe('classifyReaction: hits', () => {
  it.each<[number, ReactionSituation]>([
    [100, 'perfect'], [99, 'sharp'], [85, 'sharp'], [84, 'good'], [60, 'good'],
    [59, 'fair'], [30, 'fair'], [29, 'loose'], [1, 'loose'], [0, 'zero-hit'],
  ])('%i points is %s', (points, expected) => {
    expect(classifyReaction(hit(points))).toBe(expected);
  });

  it('treats a very wide hit as loose', () => {
    expect(classifyReaction(hit(2, { lo: 5, hi: 95 }))).toBe('loose');
  });
});

describe('classifyReaction: misses', () => {
  it('wide miss starts above a quarter of the range', () => {
    expect(classifyReaction(miss(25))).toBe('miss');
    expect(classifyReaction(miss(26))).toBe('wide-miss');
  });

  it('near miss is within 5% of the range for a narrow window', () => {
    expect(classifyReaction(miss(5))).toBe('near-miss');
    expect(classifyReaction(miss(6))).toBe('miss');
  });

  it('a wide window does not stretch a near miss ("by a hair" stays true)', () => {
    expect(classifyReaction(miss(8, { lo: 30, hi: 46 }))).toBe('miss');
    expect(classifyReaction(miss(10, { lo: 10, hi: 70 }))).toBe('miss');
    expect(classifyReaction(miss(5, { lo: 10, hi: 70 }))).toBe('near-miss');
  });

  it('no line repeats the verdict printed above it, or claims more than the round shows', () => {
    const all = Object.values(REACTIONS).flat();
    expect(all.filter((l) => /^(Inside|Outside)\b/.test(l))).toEqual([]);
    expect(all.filter((l) => /covered everything|every value|tightest|wrong end/i.test(l))).toEqual([]);
  });

  it('one step is always a near miss on a coarse ruler', () => {
    expect(classifyReaction(miss(5, { min: 0, max: 40, step: 5, lo: 10, hi: 15 }))).toBe('near-miss');
  });

  it('handles decimal rulers without float drift', () => {
    expect(classifyReaction(miss(0.45, { min: 9, max: 18, step: 0.01, lo: 10, hi: 10.1 }))).toBe('near-miss');
  });
});

describe('classifyReaction: round awareness', () => {
  it('final round swaps mid hits and ordinary misses for closing copy', () => {
    expect(classifyReaction(hit(70, { round: 4 }))).toBe('final-hit');
    expect(classifyReaction(hit(40, { round: 4 }))).toBe('final-hit');
    expect(classifyReaction(miss(15, { round: 4 }))).toBe('final-miss');
  });

  it('final round keeps the extreme outcomes', () => {
    expect(classifyReaction(hit(100, { round: 4 }))).toBe('perfect');
    expect(classifyReaction(hit(90, { round: 4 }))).toBe('sharp');
    expect(classifyReaction(hit(10, { round: 4 }))).toBe('loose');
    expect(classifyReaction(miss(2, { round: 4 }))).toBe('near-miss');
    expect(classifyReaction(miss(60, { round: 4 }))).toBe('wide-miss');
  });

  it('respects a custom run length', () => {
    expect(classifyReaction(hit(70, { round: 4, rounds: 10 }))).toBe('good');
    expect(classifyReaction(hit(70, { round: 9, rounds: 10 }))).toBe('final-hit');
  });
});

describe('classifyReaction: garbage input', () => {
  it('falls back to fair for a hit with unusable points', () => {
    expect(classifyReaction(hit(Number.NaN))).toBe('fair');
    expect(classifyReaction(hit(Number.POSITIVE_INFINITY))).toBe('fair');
  });

  it('falls back to miss for unusable miss metadata', () => {
    expect(classifyReaction(miss(Number.NaN))).toBe('miss');
    expect(classifyReaction(miss(-3))).toBe('miss');
    expect(classifyReaction(miss(3, { min: 100, max: 100 }))).toBe('miss');
    expect(classifyReaction(miss(3, { min: 100, max: 0 }))).toBe('miss');
    expect(classifyReaction(miss(3, { min: Number.NaN }))).toBe('miss');
    expect(classifyReaction(miss(80, { lo: Number.NaN, hi: Number.NaN, step: Number.NaN }))).toBe('wide-miss');
  });

  it('treats a non-boolean hit as a miss and a NaN round as non-final', () => {
    const odd = { ...miss(15), hit: 'yes' } as unknown as ReactionInput;
    expect(classifyReaction(odd)).toBe('miss');
    expect(classifyReaction(hit(70, { round: Number.NaN }))).toBe('good');
  });
});

describe('pickReaction', () => {
  it('is deterministic for the same seed and question', () => {
    const a = pickReaction(hit(90), 'seed-a', 'q1');
    for (let i = 0; i < 5; i++) expect(pickReaction(hit(90), 'seed-a', 'q1')).toEqual(a);
    expect(a.situation).toBe('sharp');
    expect(REACTIONS.sharp).toContain(a.text);
  });

  it('spreads different seeds across the variants', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(pickReaction(miss(2), `seed-${i}`, 'q1').text);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('steps past avoided lines', () => {
    const first = pickReaction(hit(90), 'seed-a', 'q1').text;
    const second = pickReaction(hit(90), 'seed-a', 'q1', [first]).text;
    expect(second).not.toBe(first);
    expect(REACTIONS.sharp).toContain(second);
  });

  it('falls back to the hashed line when the whole pool is avoided', () => {
    const first = pickReaction(hit(90), 'seed-a', 'q1').text;
    expect(pickReaction(hit(90), 'seed-a', 'q1', REACTIONS.sharp).text).toBe(first);
  });

  it('never repeats a line in a five round run of the same situation', () => {
    for (let s = 0; s < 40; s++) {
      const run = pickReactions(
        [0, 1, 2, 3, 4].map((round) => ({ input: miss(2, { round }), questionId: `q${round % 2}` })),
        `seed-${s}`,
      );
      expect(new Set(run.map((r) => r.text)).size).toBe(5);
      expect(run.every((r) => r.situation === 'near-miss')).toBe(true);
    }
  });
});

describe('REACTIONS library', () => {
  it('has at least six lines per situation', () => {
    for (const lines of Object.values(REACTIONS)) expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every line short, punctuated and plain', () => {
    for (const line of allLines) {
      expect(line.length, line).toBeLessThanOrEqual(48);
      expect(line.endsWith('.'), line).toBe(true);
      expect(line, line).not.toMatch(/[!—–]/);
      expect(line, line).not.toMatch(/\d/);
      expect(line, line).toBe(line.trim());
    }
  });

  it('has no duplicates across the library', () => {
    const lower = allLines.map((l) => l.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('has no capitalized words except at sentence starts', () => {
    for (const line of allLines) {
      const words = line.split(/\s+/);
      words.forEach((word, i) => {
        const sentenceStart = i === 0 || /[.?]$/.test(words[i - 1] ?? '');
        if (!sentenceStart) expect(word, line).not.toMatch(/^[A-Z]/);
      });
    }
  });
});
