import type { Slate } from '../content/schema';
import { COURT_HOOP, type CourtPoint } from './court-run';
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

export const SHOT_MARKER_RADIUS = 10;
export const SHOT_UNSUBMITTED_DIVIDER = 50;

const UNSUBMITTED_X = 36;
const NEAREST_SHOT = 65;
const FARTHEST_SHOT = 251;
// Fixed question lanes separate markers even when their shot values match.
const LANE_OFFSETS = [0, -51, 51, -26, 26];

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
    const yOffset = LANE_OFFSETS[index]!;
    const y = COURT_HOOP.y + yOffset;
    const earned = record.points;
    if (record.timedOut) {
      return { number, potential: null, earned, outcome: 'timeout', x: UNSUBMITTED_X, y };
    }

    const potential = savedPotential(slate, record, index);
    if (potential === null) {
      return { number, potential, earned, outcome: 'unavailable', x: UNSUBMITTED_X, y };
    }

    const distance = NEAREST_SHOT + (FARTHEST_SHOT - NEAREST_SHOT) * potential / MAX_POINTS_PER_ROUND;
    const x = COURT_HOOP.x - Math.sqrt(distance * distance - yOffset * yOffset);
    const outcome = !record.hit ? 'missed' : earned > 0 ? 'made' : 'zero';
    return { number, potential, earned, outcome, x, y };
  });
}
