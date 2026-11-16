/**
 * Survival fairness simulation. Reproducible (seeded); no network.
 *
 *   node --experimental-strip-types scripts/survival-sim.ts [--asof YYYY-MM-DD] [--runs 20000]
 *
 * It plays thousands of runs against the real eligible pool on a given UTC day
 * with four made-up players and prints, per candidate ladder, how far they get.
 * The players are ASSUMPTIONS, not measurements:
 *   - centre:   knows nothing; centres the widest passing window on the middle of the scale.
 *   - casual:   guess error SD = 22% of the scale
 *   - informed: 12%
 *   - sharp:     6%
 * scaled by tier (easy ×0.6, medium ×0.85, hard ×1, expert ×1.25). Every player
 * plays the widest window that still earns the round's minimum, centred on their
 * guess (moved inward at the scale's ends), which maximises survival.
 *
 * It also lists questions whose passing window is two steps or fewer at the
 * hardest round of their tier, i.e. ones that demand a near-exact answer.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Difficulty, Question, Slate } from '../src/content/schema.ts';
import { puzzleDay } from '../src/engine/daily.ts';
import { fromSteps, potentialPoints, rangeSteps, scoreWindow } from '../src/engine/scoring.ts';
import type { SurvivalCatalog } from '../src/survival/catalog.ts';
import { eligiblePool, questionLookup, supplyOf } from '../src/survival/pool.ts';
import { MIN_PASS_STEPS, SURVIVAL_ROUNDS, THRESHOLDS, TIER_BY_ROUND } from '../src/survival/rules.ts';
import { pickRun, prng } from '../src/survival/select.ts';

const ROOT = join(import.meta.dirname, '..');

export function loadAll(): { catalog: SurvivalCatalog; slates: Slate[] } {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'content', 'survival', 'catalog.json'), 'utf8')) as SurvivalCatalog;
  const dir = join(ROOT, 'content', 'days');
  const slates = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Slate);
  return { catalog, slates };
}

/** Widest window, in steps, that still earns at least `t` points on this scale. */
export function widestPassing(q: Question, t: number): number {
  const R = rangeSteps(q);
  let best = 0;
  for (let w = 1; w <= R; w++) {
    if (potentialPoints(q, { lo: q.min, hi: fromSteps(q, w) }) >= t) best = w;
    else break;
  }
  return best;
}

const TIER_FACTOR: Record<Difficulty, number> = { easy: 0.6, medium: 0.85, hard: 1, expert: 1.25 };
export const PLAYERS = { centre: null, casual: 0.22, informed: 0.12, sharp: 0.06 } as const;
export type Player = keyof typeof PLAYERS;

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function playRound(q: Question, tier: Difficulty, t: number, player: Player, rand: () => number): boolean {
  const R = rangeSteps(q);
  const w = widestPassing(q, t);
  if (w === 0) return false;
  const a = (q.answer - q.min) / q.step;
  const sd = PLAYERS[player];
  const guess = sd === null ? R / 2 : a + gauss(rand) * sd * TIER_FACTOR[tier] * R;
  const lo = Math.min(R - w, Math.max(0, Math.round(guess - w / 2)));
  const s = scoreWindow(q, { lo: fromSteps(q, lo), hi: fromSteps(q, lo + w) });
  return s.hit && s.points >= t;
}

export type SimResult = { player: Player; reached: number[]; wins: number; median: number; runs: number };

export function simulate(questions: Map<string, Question>, runs: string[][], ladder: readonly number[], player: Player, seed = 1): SimResult {
  const rand = prng(seed);
  const reached = Array.from({ length: SURVIVAL_ROUNDS + 1 }, () => 0);
  const survived: number[] = [];
  for (const run of runs) {
    let r = 0;
    while (r < SURVIVAL_ROUNDS && playRound(questions.get(run[r]!)!, TIER_BY_ROUND[r]!, ladder[r]!, player, rand)) r++;
    for (let i = 0; i <= r; i++) reached[i]!++;
    survived.push(r);
  }
  survived.sort((x, y) => x - y);
  return { player, reached, wins: reached[SURVIVAL_ROUNDS]!, median: survived[Math.floor(survived.length / 2)]!, runs: runs.length };
}

export const LADDERS: Record<string, readonly number[]> = {
  'brief (20…89)': [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 68, 71, 74, 77, 79, 81, 83, 85, 87, 89],
  'gentle (15…75)': [15, 20, 25, 30, 35, 40, 44, 48, 52, 55, 58, 61, 63, 65, 67, 69, 71, 73, 74, 75],
  'sv1, shipped (20…80)': THRESHOLDS,
};

function main() {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const asof = arg('--asof') ?? puzzleDay(new Date());
  const nRuns = Number(arg('--runs') ?? 20000);
  const { catalog, slates } = loadAll();
  const pool = eligiblePool(catalog, asof, slates.map((s) => s.date));
  const supply = supplyOf(pool, asof);
  const questions = questionLookup(catalog, slates);
  console.log(`# Survival simulation as of ${asof}\n`);
  console.log(`Eligible: ${supply.total} (easy ${supply.byTier.easy}, medium ${supply.byTier.medium}, hard ${supply.byTier.hard}, expert ${supply.byTier.expert}). Playable: ${supply.playable}. Beta gate: ${supply.beta ? 'pass' : `fail (${supply.short.join('; ')})`}.\n`);
  if (!supply.playable) {
    console.log('Not enough questions for one run: nothing to simulate.');
    return;
  }
  const seeds = prng(42);
  for (const [name, ladder] of Object.entries(LADDERS)) {
    const runs: string[][] = [];
    let failed = 0;
    for (let i = 0; i < nRuns; i++) {
      const run = pickRun(pool, Math.floor(seeds() * 2 ** 32), new Set(), ladder);
      if (run) runs.push(run);
      else failed++;
    }
    console.log(`## Ladder ${name}\n`);
    console.log(`Thresholds: ${ladder.join(', ')}\n`);
    if (failed) console.log(`Runs the picker could not fill (a tier ran short after the ${'MIN_PASS_STEPS'} rule): ${failed} of ${nRuns}\n`);
    if (!runs.length) continue;
    console.log('| Player | reach R5 | reach R9 | reach R13 | reach R17 | win (20/20) | median rounds survived |');
    console.log('|---|---|---|---|---|---|---|');
    for (const p of Object.keys(PLAYERS) as Player[]) {
      const s = simulate(questions, runs, ladder, p, 7);
      const pct = (r: number) => `${((s.reached[r]! / s.runs) * 100).toFixed(1)}%`;
      console.log(`| ${p} | ${pct(4)} | ${pct(8)} | ${pct(12)} | ${pct(16)} | ${pct(20)} | ${s.median} |`);
    }
    // Questions that need a near-exact answer at the hardest round of their tier.
    const tight: string[] = [];
    const worstT: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
    TIER_BY_ROUND.forEach((t, r) => (worstT[t] = Math.max(worstT[t], ladder[r]!)));
    for (const e of pool) {
      const q = questions.get(e.id)!;
      const w = widestPassing(q, worstT[e.tag.tier]);
      if (w <= MIN_PASS_STEPS) tight.push(`${e.id} (${e.tag.tier}, ${rangeSteps(q)}-step scale, widest passing window ${w} step${w === 1 ? '' : 's'} at ${worstT[e.tag.tier]})`);
    }
    console.log(`\nQuestions whose passing window is ${MIN_PASS_STEPS} steps or fewer at their tier's hardest round (under ${MIN_PASS_STEPS} they are skipped for that round): ${tight.length}${tight.length ? `\n- ${tight.join('\n- ')}` : ''}\n`);
  }
}

if (process.argv[1]?.endsWith('survival-sim.ts')) main();
