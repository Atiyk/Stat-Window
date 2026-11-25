import { HALF_COURT_CENTER, HOOP, FREE_THROW_X, COURT, type CourtPoint } from './court';
import { currentQuestion, ROUNDS, totalPoints, type GameState, type RoundRecord } from './game';
import { potentialPoints } from './scoring';
import { MAX_TOTAL } from './summary';

export type { CourtPoint };
export type CourtCheckpoint = CourtPoint & { readonly number: number; readonly total: number };

/** The run starts on the centre of the half-court line and ends on the basket. */
export const COURT_START = HALF_COURT_CENTER;
export const COURT_END = HOOP;

export function courtProgress(total: number): number {
  return Number.isNaN(total) ? 0 : Math.min(1, Math.max(0, total / MAX_TOTAL));
}

/** Points to feet: proportional, on the straight line from half court to the hoop. */
export function courtPosition(total: number): CourtPoint {
  const t = courtProgress(total);
  return {
    x: COURT_START.x + (COURT_END.x - COURT_START.x) * t,
    y: COURT_START.y + (COURT_END.y - COURT_START.y) * t,
  };
}

/**
 * The two balls on the live court.
 * - `earned`: the points already awarded and revealed. It never includes the
 *   current round until that round resolves, so it cannot leak an outcome.
 * - `potential`: where `earned` would go if the current window catches the answer,
 *   or null when there is nothing to preview (zero-point window, timeout, after the
 *   reveal). After a lock it is frozen to the submitted window, not the live input.
 */
export type CourtRunMarkers = { readonly earned: number; readonly potential: number | null };

export function courtRunMarkers(state: Pick<GameState, 'phase' | 'round' | 'results' | 'slate' | 'window'>): CourtRunMarkers {
  const { phase, round, results } = state;
  if (phase === 'resolved' || phase === 'complete') {
    return { earned: totalPoints(results.slice(0, Math.min(ROUNDS, round + 1))), potential: null };
  }
  const earned = totalPoints(results.slice(0, round));
  const question = currentQuestion(state as GameState);
  let worth = 0;
  if (phase === 'ready' || phase === 'adjusting') {
    worth = safePotential(question, state.window);
  } else {
    const submitted = results[round];
    worth = submitted && !submitted.timedOut && submitted.questionId === question.id
      ? safePotential(question, submitted) : 0;
  }
  return { earned, potential: worth > 0 ? Math.min(MAX_TOTAL, earned + worth) : null };
}

function safePotential(question: ReturnType<typeof currentQuestion>, window: { lo: number; hi: number }): number {
  try {
    return potentialPoints(question, window);
  } catch (error) {
    if (error instanceof RangeError) return 0;
    throw error;
  }
}

export function courtRunCheckpoints(results: readonly Pick<RoundRecord, 'points'>[]): CourtCheckpoint[] {
  let total = 0;
  return results.slice(0, ROUNDS).map(({ points }, index) => {
    total += points;
    return { ...courtPosition(total), number: index + 1, total };
  });
}

export const CHECKPOINT_RADIUS = 1.35;
const checkpointOffsets = [-4, 4, -7.5, 7.5, -11] as const;

/** Labels sit on stems above and below the true score position, so equal scores never overlap. */
export function courtCheckpointMarker(checkpoint: CourtCheckpoint): CourtPoint {
  return {
    x: Math.max(checkpoint.x, CHECKPOINT_RADIUS + 0.3),
    y: checkpoint.y + (checkpointOffsets[checkpoint.number - 1] ?? 0),
  };
}

/** The first total whose ball centre is on or past a court feature. */
const totalAt = (x: number) => Math.ceil(((x - COURT_START.x) / (COURT_END.x - COURT_START.x)) * MAX_TOTAL);

/** Real court features along the route, in the order the ball reaches them. */
export const COURT_LANDMARKS = [
  { name: 'the three-point line', at: totalAt(HOOP.x - COURT.threePointRadius) },
  { name: 'the free-throw line', at: totalAt(FREE_THROW_X) },
  { name: 'the restricted area', at: totalAt(HOOP.x - COURT.restrictedRadius) },
  { name: 'the rim', at: MAX_TOTAL },
] as const;

export type CourtLandmark = (typeof COURT_LANDMARKS)[number];

/** The furthest feature reached, and the next one, for truthful copy about the run. */
export function courtLandmarks(total: number): { reached: CourtLandmark | null; next: CourtLandmark | null } {
  const reached = COURT_LANDMARKS.filter((landmark) => total >= landmark.at).at(-1) ?? null;
  const next = COURT_LANDMARKS.find((landmark) => total < landmark.at) ?? null;
  return { reached, next };
}
