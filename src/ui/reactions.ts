import { funFactIndex } from './fun-facts';

/**
 * Contextual one-liners shown after a round reveals.
 *
 * Rules (classifyReaction) and copy (REACTIONS) are kept apart so editors can
 * change lines without touching thresholds.
 *
 * Thresholds, in order:
 *   Hit:   100 perfect | 85-99 sharp | 60-84 good | 30-59 fair | 1-29 loose | 0 zero-hit
 *   Miss:  wide-miss  when missBy > 25% of the ruler range
 *          near-miss  when missBy <= the larger of one step and 5% of the ruler range
 *                     (a wide window does not stretch it: "by a hair" must stay true)
 *          miss       otherwise
 *   Final round (last round of the run): good/fair hits use 'final-hit' and
 *   ordinary misses use 'final-miss'. The extreme outcomes (perfect, sharp,
 *   loose, zero-hit, near-miss, wide-miss) keep their own copy.
 *   Garbage input: a hit with unusable points is 'fair'; anything else
 *   unusable (no boolean hit, NaN missBy, min >= max) is 'miss'.
 */
export type ReactionSituation =
  | 'perfect'
  | 'sharp'
  | 'good'
  | 'fair'
  | 'loose'
  | 'zero-hit'
  | 'near-miss'
  | 'miss'
  | 'wide-miss'
  | 'final-hit'
  | 'final-miss';

export type ReactionInput = {
  readonly hit: boolean;
  readonly points: number;
  readonly missBy: number;
  readonly lo: number;
  readonly hi: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** 0-based round index. */
  readonly round: number;
  /** Rounds in the run. Defaults to 5. */
  readonly rounds?: number;
};

export type Reaction = { readonly situation: ReactionSituation; readonly text: string };

const DEFAULT_ROUNDS = 5;
const WIDE_MISS_SHARE = 0.25;
const NEAR_MISS_SHARE = 0.05;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function hitSituation(points: number): ReactionSituation {
  if (!finite(points)) return 'fair';
  if (points >= 100) return 'perfect';
  if (points >= 85) return 'sharp';
  if (points >= 60) return 'good';
  if (points >= 30) return 'fair';
  if (points > 0) return 'loose';
  return 'zero-hit';
}

function missSituation(input: ReactionInput): ReactionSituation {
  const { missBy, min, max } = input;
  if (!finite(missBy) || missBy < 0 || !finite(min) || !finite(max) || min >= max) return 'miss';
  const range = max - min;
  const eps = range * 1e-9; // absorbs float drift on decimal rulers
  if (missBy > range * WIDE_MISS_SHARE + eps) return 'wide-miss';
  const step = finite(input.step) && input.step > 0 ? input.step : 0;
  const nearLimit = Math.max(step, range * NEAR_MISS_SHARE);
  return missBy <= nearLimit + eps ? 'near-miss' : 'miss';
}

export function classifyReaction(input: ReactionInput): ReactionSituation {
  const base = input.hit === true ? hitSituation(input.points) : missSituation(input);
  const rounds = finite(input.rounds) && input.rounds > 0 ? input.rounds : DEFAULT_ROUNDS;
  const isFinal = finite(input.round) && input.round === rounds - 1;
  if (!isFinal) return base;
  if (base === 'good' || base === 'fair') return 'final-hit';
  if (base === 'miss') return 'final-miss';
  return base;
}

/** Editorial copy. Each line: one sentence or two, ends in a period, <= 48 chars. */
export const REACTIONS: Record<ReactionSituation, readonly string[]> = {
  perfect: [
    'Nailed to the notch.',
    'Right on it.',
    'Full marks. No hedging.',
    'Every point on the table.',
    'No wiggle room needed.',
    'You left nothing on the board.',
    'Pinned it.',
  ],
  sharp: [
    'You knew that one.',
    'Barely any room. Still inside.',
    'That was confidence.',
    'Tight and right.',
    'Almost no margin to spare.',
    'Bold window. It paid.',
    'Hard to squeeze much more out.',
  ],
  good: [
    'Solid read.',
    'Good window, a little room left.',
    'Close enough to count big.',
    'You trusted your number.',
    'Room to tighten, still a good one.',
    'A confident call.',
    'Healthy points, fair margin.',
  ],
  fair: [
    'Caught it.',
    'Some cushion, still scoring.',
    'Played it halfway safe.',
    'Decent. You can go tighter.',
    'A fair hedge.',
    'Points banked. Room left over.',
    'Middle of the road.',
  ],
  loose: [
    'Safe, but it cost you.',
    'Caught, but loose.',
    'That window had room to spare.',
    'A catch, for not much.',
    'Plenty of cushion, few points.',
    'You played it very safe.',
    'The hedge ate the points.',
  ],
  'zero-hit': [
    'Caught, for nothing.',
    'Too much room to score.',
    'All cushion, no points.',
    'Safe as houses. No reward.',
    'You hedged it all away.',
    "Can't miss, can't score.",
  ],
  'near-miss': [
    'That one hurts.',
    'Just outside.',
    'One nudge away.',
    'So close to the edge.',
    'Missed by a hair.',
    'The edge let you down.',
    'A touch wider would have done it.',
  ],
  miss: [
    'Not this one.',
    'Not this time.',
    'The number got away.',
    'Off the mark.',
    'That one slipped past.',
    'Your window was elsewhere.',
    'Missed it. Next one.',
  ],
  'wide-miss': [
    'Way off this time.',
    'That one ran away from you.',
    'That number was far away.',
    'Looking in the wrong place.',
    'A long way outside.',
    'This one fooled you.',
    'Big swing, big miss.',
  ],
  'final-hit': [
    'Points banked to close it out.',
    'A steady finish.',
    'You closed it out inside.',
    'The last one counts. Got it.',
    'Finished on a hit.',
    'Ended with points on the board.',
  ],
  'final-miss': [
    'No points to finish.',
    'The last one got away.',
    'Tough way to end it.',
    'Wide of it on the final call.',
    'That closer slipped past.',
    'A quiet finish.',
  ],
};

/**
 * Deterministic per (seed, questionId, situation). Lines in `avoid` (already
 * shown earlier this run) are skipped by stepping to the next variant; if the
 * whole pool is avoided, the hashed line is used anyway.
 */
export function pickReaction(
  input: ReactionInput,
  seed: string,
  questionId: string,
  avoid: readonly string[] = [],
): Reaction {
  const situation = classifyReaction(input);
  const pool = REACTIONS[situation];
  const start = Math.max(0, funFactIndex(`${questionId}:${situation}`, pool.length, seed));
  for (let i = 0; i < pool.length; i++) {
    const text = pool[(start + i) % pool.length];
    if (text !== undefined && !avoid.includes(text)) return { situation, text };
  }
  return { situation, text: pool[start] ?? '' };
}

/** Picks a line for each round in order, never repeating a line within the run when avoidable. */
export function pickReactions(
  rounds: readonly { readonly input: ReactionInput; readonly questionId: string }[],
  seed: string,
): Reaction[] {
  const shown: string[] = [];
  return rounds.map(({ input, questionId }) => {
    const reaction = pickReaction(input, seed, questionId, shown);
    shown.push(reaction.text);
    return reaction;
  });
}
