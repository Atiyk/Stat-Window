/**
 * Stat Window scoring. Spec: docs/SCORING.md.
 *
 * A window [lo, hi] is a hit when lo <= answer <= hi (both edges inclusive).
 * Width is measured in steps. The tightest legal window is one step wide.
 *   fraction = (rangeSteps - widthSteps) / (rangeSteps - 1)
 *   points   = round(100 * fraction^2)   on a hit
 *   points   = 0                          on a miss
 * Everything is computed on integer step counts so decimal questions
 * (9.58 seconds, 8.90 metres) never suffer floating-point drift.
 */

export type Scale = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
};

export type Scored = Scale & { readonly answer: number };

export type Window = { readonly lo: number; readonly hi: number };

export type RoundScore = {
  readonly hit: boolean;
  readonly points: number;
  /** Distance from the nearest window edge to the answer, 0 on a hit. */
  readonly missBy: number;
};

export const MAX_POINTS_PER_ROUND = 100;

/** Number of decimals implied by a step (0.01 -> 2). */
export function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Converts a value to integer steps above `min`. */
export function toSteps(scale: Scale, value: number): number {
  return Math.round((value - scale.min) / scale.step);
}

/** Converts integer steps above `min` back to a clean value. */
export function fromSteps(scale: Scale, steps: number): number {
  const d = stepDecimals(scale.step);
  return Number((scale.min + steps * scale.step).toFixed(d));
}

export function rangeSteps(scale: Scale): number {
  return toSteps(scale, scale.max);
}

export function assertLegalWindow(scale: Scale, w: Window): void {
  const lo = toSteps(scale, w.lo);
  const hi = toSteps(scale, w.hi);
  if (lo < 0 || hi > rangeSteps(scale)) throw new RangeError('Window is outside the scale');
  if (hi - lo < 1) throw new RangeError('Window must be at least one step wide');
}

export function isHit(q: Scored, w: Window): boolean {
  // Compare on a fine integer grid so 9.58 vs 9.58 is exact.
  const f = 10 ** stepDecimals(q.step);
  const a = Math.round(q.answer * f);
  return Math.round(w.lo * f) <= a && a <= Math.round(w.hi * f);
}

export function potentialPoints(scale: Scale, w: Window): number {
  assertLegalWindow(scale, w);
  const range = rangeSteps(scale);
  const width = toSteps(scale, w.hi) - toSteps(scale, w.lo);
  const fraction = (range - width) / (range - 1);
  return Math.round(MAX_POINTS_PER_ROUND * fraction * fraction);
}

export function scoreWindow(q: Scored, w: Window): RoundScore {
  const points = potentialPoints(q, w);
  if (isHit(q, w)) return { hit: true, points, missBy: 0 };
  const d = stepDecimals(q.step);
  const gap = q.answer < w.lo ? w.lo - q.answer : q.answer - w.hi;
  return { hit: false, points: 0, missBy: Number(gap.toFixed(d)) };
}
