import type { RoundRecord } from './game';
import { MAX_TOTAL } from './summary';

export type CourtPoint = { readonly x: number; readonly y: number };
export type CourtCheckpoint = CourtPoint & { readonly number: number; readonly total: number };

export const COURT_WIDTH = 360;
export const COURT_HEIGHT = 180;
export const COURT_START: CourtPoint = { x: 24, y: 90 };
export const COURT_HOOP: CourtPoint = { x: 316, y: 90 };

/** Original court linework in the coordinate system used by SVG and canvas. */
export const COURT_LINES = [
  'M24 12H344V168H24Z',
  'M24 63A27 27 0 0 1 24 117',
  'M344 25H311C261 25 226 54 226 90S261 155 311 155H344',
  'M344 60H276V120H344M276 60A30 30 0 0 0 276 120',
  'M329 80V100M323 90A7 7 0 1 1 309 90A7 7 0 1 1 323 90H329',
] as const;

const checkpointOffsets = [-18, 18, -38, 38, -58] as const;

export function courtProgress(total: number): number {
  return Number.isNaN(total) ? 0 : Math.min(1, Math.max(0, total / MAX_TOTAL));
}

export function courtPosition(total: number): CourtPoint {
  return {
    x: COURT_START.x + (COURT_HOOP.x - COURT_START.x) * courtProgress(total),
    y: COURT_START.y,
  };
}

export function courtRunCheckpoints(results: readonly Pick<RoundRecord, 'points'>[]): CourtCheckpoint[] {
  let total = 0;
  return results.map(({ points }, index) => {
    total += points;
    return { ...courtPosition(total), number: index + 1, total };
  });
}

/** Anchor every label to its true score x, even when several rounds earned zero. */
export function courtCheckpointMarkerY(checkpoint: CourtCheckpoint): number {
  return checkpoint.y + (checkpointOffsets[checkpoint.number - 1] ?? 0);
}
