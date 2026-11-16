import type { Difficulty } from '../content/schema.ts';
import { potentialPoints } from '../engine/scoring.ts';

/**
 * Survival rules. Spec and the simulation behind these numbers: docs/SURVIVAL.md.
 *
 * Bump RULESET whenever a threshold, the round count or the tier plan changes:
 * personal bests are only compared within one ruleset.
 */
export const RULESET = 'sv1';
export const SURVIVAL_ROUNDS = 20;

/**
 * Minimum points (out of 100) a round must earn to survive. A miss scores 0, so
 * it always ends the run. Index 0 is round 1.
 */
export const THRESHOLDS: readonly number[] = [
  20, 25, 30, 35, 40, 44, 48, 52, 55, 58, 61, 63, 65, 67, 69, 71, 73, 75, 78, 80,
];

/** Which difficulty tier each round draws from. Rounds 13–16 are hard questions with tighter windows. */
export const TIER_BY_ROUND: readonly Difficulty[] = [
  'easy', 'easy', 'easy', 'easy',
  'medium', 'medium', 'medium', 'medium',
  'hard', 'hard', 'hard', 'hard',
  'hard', 'hard', 'hard', 'hard',
  'expert', 'expert', 'expert', 'expert',
];

/** Label shown on screen. Editorial, not a measured skill rating. */
export function roundLabel(round: number): string {
  if (round < 4) return 'Easy';
  if (round < 8) return 'Medium';
  if (round < 12) return 'Hard';
  if (round < 16) return 'Very hard';
  return 'Expert';
}

export const need = (round: number): number => THRESHOLDS[Math.min(round, SURVIVAL_ROUNDS - 1)]!;

/** Questions one run draws from each tier. */
export function perRunNeed(): Record<Difficulty, number> {
  const out: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
  for (const t of TIER_BY_ROUND) out[t]++;
  return out;
}

/**
 * Public-beta gate: at least 100 eligible questions, and each tier holds at least
 * three runs' worth, so back-to-back runs are not near copies. A pragmatic launch
 * line, not a statistical rule.
 */
export const BETA_MIN_TOTAL = 100;
export const BETA_TIER_MULTIPLE = 3;
/** How many earlier runs' questions the picker tries to avoid. */
export const RECENT_RUNS = 3;

/**
 * Widest window, in steps, that still earns `t` points on a scale `steps` long.
 * Uses the Daily Five scoring function itself, so it can never drift from it.
 */
export function widestPassing(steps: number, t: number): number {
  const scale = { min: 0, max: steps, step: 1 };
  let best = 0;
  for (let w = 1; w <= steps; w++) {
    if (potentialPoints(scale, { lo: 0, hi: w }) >= t) best = w;
    else break;
  }
  return best;
}

/**
 * A question may sit in a round only when the passing window there is at least
 * this many steps wide, so no round demands one exact pair of values.
 */
export const MIN_PASS_STEPS = 2;
