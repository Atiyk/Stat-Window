import type { Slate } from '../content/schema';
import { HOOP, type CourtPoint } from './court';
import { ROUNDS, type RoundRecord } from './game';
import { MAX_POINTS_PER_ROUND, potentialPoints } from './scoring';

export const SHOT_OUTCOME_LABELS = {
  made: 'Scored',
  missed: 'Missed',
  timeout: 'Timeout',
  zero: '0-point catch',
  unavailable: 'Unavailable',
} as const;

type ShotOutcome = keyof typeof SHOT_OUTCOME_LABELS;

/** Safe to pass to a share renderer: contains only positions and scoring metadata. */
export type ShotAttempt = CourtPoint & {
  readonly number: number;
  readonly potential: number | null;
  readonly earned: number;
  readonly outcome: ShotOutcome;
};

/** Feet. Markers never overlap: see the separation test. */
export const SHOT_MARKER_RADIUS = 1.45;
/** Attempts without a submitted window sit behind this line, off the risk axis. */
export const SHOT_UNSUBMITTED_DIVIDER = 5;

const UNSUBMITTED_X = 2.5;
const UNSUBMITTED_SPACING = 3.8;
/** 0 potential points sits at the rim's edge; 100 is a deep three (the arc is 23.75 ft). */
const NEAREST_SHOT = 7;
const FARTHEST_SHOT = 28;
/** Each question keeps its own direction from the basket, so equal risks stay apart. */
const LANE_DEGREES = [-54, -27, 0, 27, 54] as const;

/** Feet from the basket for a window worth `potential` points at the time it was locked. */
export function shotDistance(potential: number): number {
  const p = Math.min(MAX_POINTS_PER_ROUND, Math.max(0, potential));
  return NEAREST_SHOT + (FARTHEST_SHOT - NEAREST_SHOT) * p / MAX_POINTS_PER_ROUND;
}

function savedPotential(slate: Slate, record: RoundRecord, index: number): number | null {
  const question = slate.questions[index];
  if (!question || question.id !== record.questionId) return null;
  if (!Number.isFinite(record.lo) || !Number.isFinite(record.hi)) return null;
  if (record.lo < question.min || record.hi > question.max) return null;
  try {
    return potentialPoints(question, record);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Risk is the radial distance to the hoop. The same coordinates power the app and exports. */
export function buildShotChart(slate: Slate, results: readonly RoundRecord[]): readonly ShotAttempt[] {
  return results.slice(0, ROUNDS).map((record, index) => {
    const number = index + 1;
    const earned = record.points;
    const unsubmitted = { x: UNSUBMITTED_X, y: HOOP.y + (index - 2) * UNSUBMITTED_SPACING };
    if (record.timedOut) {
      return { number, potential: null, earned, outcome: 'timeout', ...unsubmitted };
    }

    const potential = savedPotential(slate, record, index);
    if (potential === null) {
      return { number, potential, earned, outcome: 'unavailable', ...unsubmitted };
    }

    const angle = (LANE_DEGREES[index]! * Math.PI) / 180;
    const distance = shotDistance(potential);
    const outcome = !record.hit ? 'missed' : earned > 0 ? 'made' : 'zero';
    return {
      number, potential, earned, outcome,
      x: HOOP.x - distance * Math.cos(angle),
      y: HOOP.y + distance * Math.sin(angle),
    };
  });
}
