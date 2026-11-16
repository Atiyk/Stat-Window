import type { PoolEntry } from './pool.ts';
import { MIN_PASS_STEPS, SURVIVAL_ROUNDS, THRESHOLDS, TIER_BY_ROUND, widestPassing } from './rules.ts';

/** Small, fast, seeded PRNG (mulberry32). Same seed, same sequence, on every browser. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the 20 questions of one run, in round order. Deterministic for a given
 * pool, seed and recent list. Each round draws from its tier only (rules.ts);
 * if a tier runs short the pick fails (returns null) instead of borrowing a
 * harder or easier question. A question whose passing window in that round would
 * be under MIN_PASS_STEPS wide is skipped for that round.
 *
 * Within a tier it prefers, in order of weight: questions not seen in the
 * player's last few runs, a franchise, stat family and source day not already
 * in this run, and a different franchise and era from the round before. These
 * are preferences, not promises: a small pool repeats.
 */
export function pickRun(
  pool: readonly PoolEntry[],
  seed: number,
  recent: ReadonlySet<string> = new Set(),
  thresholds: readonly number[] = THRESHOLDS,
): string[] | null {
  const rand = prng(seed);
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const chosen: PoolEntry[] = [];
  const used = new Set<string>();
  const count = (key: (e: PoolEntry) => string | null, v: string | null) =>
    v === null ? 0 : chosen.reduce((n, e) => n + (key(e) === v ? 1 : 0), 0);
  for (let r = 0; r < SURVIVAL_ROUNDS; r++) {
    const tier = TIER_BY_ROUND[r]!;
    const prev = chosen.at(-1);
    let best: PoolEntry | null = null;
    let bestScore = Infinity;
    for (const e of sorted) {
      // Draw for every entry, even skipped ones, so one entry's eligibility never shifts another's luck.
      const u = rand();
      if (e.tag.tier !== tier || used.has(e.id)) continue;
      if (widestPassing(e.tag.steps, thresholds[r]!) < MIN_PASS_STEPS) continue;
      let score = u;
      if (recent.has(e.id)) score += 10;
      score += 1.0 * count((x) => x.tag.franchise, e.tag.franchise);
      score += 0.8 * count((x) => x.tag.family, e.tag.family);
      score += 0.7 * count((x) => x.tag.day, e.tag.day);
      if (prev && e.tag.franchise !== null && prev.tag.franchise === e.tag.franchise) score += 2;
      if (prev && prev.tag.era === e.tag.era) score += 0.5;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) return null;
    chosen.push(best);
    used.add(best.id);
  }
  return chosen.map((e) => e.id);
}

/** A fresh 32-bit seed. Not secret: it only makes a run reproducible. */
export function newSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}
