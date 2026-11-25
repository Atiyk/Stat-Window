/**
 * One NBA half court, in feet. Every court drawn by Stat Window (the live Court Run,
 * the results recap, the Shot Chart and the canvas share cards) reads this module.
 *
 * Coordinates: x = 0 is the half-court line, x = 47 the baseline; y = 0 and y = 50 are
 * the sidelines. Callers scale x and y by the same factor, so the court keeps its
 * real 47 × 50 proportions.
 *
 * Measurements follow NBA Rule No. 1 and the official court diagram
 * (https://official.nba.com/rule-no-1-court-dimensions-equipment/):
 * - Court 94 × 50 ft; lines are 2 in wide.
 * - Backboard face 4 ft in from the baseline, 6 ft wide. Ring 18 in inside diameter,
 *   its nearest inside edge 6 in from the backboard, so the basket centre is
 *   4 + 0.5 + 0.75 = 5.25 ft (5 ft 3 in) from the baseline.
 * - Free-throw line 15 ft from the backboard face, so 19 ft from the baseline to its
 *   far edge. Lane 16 ft wide (outside edges). Free-throw circle 6 ft radius.
 * - Three-point arc 23 ft 9 in from the basket centre to the outside edge; the corner
 *   lines run parallel to the sidelines 3 ft in, 22 ft from the basket centre.
 * - Restricted area arc 4 ft from the basket centre (inside edge).
 * - Centre circle 12 ft diameter (outside edge).
 *
 * Each line is drawn on its centreline, half a line width inside the edge the rule
 * measures to, so the measured edge lands where the rulebook puts it.
 */
export type CourtPoint = { readonly x: number; readonly y: number };

export const COURT = {
  length: 47,
  width: 50,
  line: 2 / 12,
  centerCircleRadius: 6,
  laneWidth: 16,
  freeThrowFromBaseline: 19,
  freeThrowCircleRadius: 6,
  threePointRadius: 23.75,
  cornerThreeFromSideline: 3,
  restrictedRadius: 4,
  backboardFromBaseline: 4,
  backboardWidth: 6,
  rimInnerRadius: 0.75,
  rimFromBackboard: 0.5,
} as const;

const MID_Y = COURT.width / 2;
const HALF_LINE = COURT.line / 2;

export const HALF_COURT_CENTER: CourtPoint = { x: 0, y: MID_Y };
export const BACKBOARD_X = COURT.length - COURT.backboardFromBaseline;
export const HOOP: CourtPoint = {
  x: BACKBOARD_X - COURT.rimFromBackboard - COURT.rimInnerRadius,
  y: MID_Y,
};
export const FREE_THROW_X = COURT.length - COURT.freeThrowFromBaseline;
/** Where the arc meets the straight corner lines, measured at the outside edge. */
export const CORNER_THREE_DISTANCE = MID_Y - COURT.cornerThreeFromSideline;
export const THREE_POINT_BREAK_X =
  HOOP.x - Math.sqrt(COURT.threePointRadius ** 2 - CORNER_THREE_DISTANCE ** 2);

const r = (n: number) => Math.round(n * 1000) / 1000;

export type CourtLine = { readonly d: string; readonly kind: 'line' | 'dashed' | 'boundary' | 'rim' | 'board' };

function courtLines(): readonly CourtLine[] {
  const L = COURT.length;
  const W = COURT.width;
  const top = -HALF_LINE;
  const bottom = W + HALF_LINE;
  const base = L + HALF_LINE;

  const center = COURT.centerCircleRadius - HALF_LINE;

  const laneTop = MID_Y - COURT.laneWidth / 2 + HALF_LINE;
  const laneBottom = MID_Y + COURT.laneWidth / 2 - HALF_LINE;
  const ft = FREE_THROW_X + HALF_LINE;
  const ftR = COURT.freeThrowCircleRadius - HALF_LINE;

  const cornerTop = COURT.cornerThreeFromSideline + HALF_LINE;
  const cornerBottom = W - cornerTop;
  const arcR = COURT.threePointRadius - HALF_LINE;
  const breakX = HOOP.x - Math.sqrt(arcR ** 2 - (MID_Y - cornerTop) ** 2);

  const ra = COURT.restrictedRadius + HALF_LINE;
  const rim = COURT.rimInnerRadius + HALF_LINE;

  return [
    // Sidelines, baseline and the half-court line.
    { kind: 'boundary', d: `M0 ${r(top)}H${r(base)}V${r(bottom)}H0` },
    { kind: 'boundary', d: `M0 ${r(top)}V${r(bottom)}` },
    { kind: 'line', d: `M0 ${r(MID_Y - center)}A${r(center)} ${r(center)} 0 0 1 0 ${r(MID_Y + center)}` },
    { kind: 'line', d: `M${L} ${r(laneTop)}H${r(ft)}V${r(laneBottom)}H${L}` },
    { kind: 'line', d: `M${r(ft)} ${r(MID_Y - ftR)}A${r(ftR)} ${r(ftR)} 0 0 0 ${r(ft)} ${r(MID_Y + ftR)}` },
    { kind: 'dashed', d: `M${r(ft)} ${r(MID_Y - ftR)}A${r(ftR)} ${r(ftR)} 0 0 1 ${r(ft)} ${r(MID_Y + ftR)}` },
    {
      kind: 'line',
      d: `M${L} ${r(cornerTop)}H${r(breakX)}A${r(arcR)} ${r(arcR)} 0 0 0 ${r(breakX)} ${r(cornerBottom)}H${L}`,
    },
    {
      kind: 'line',
      d: `M${r(BACKBOARD_X)} ${r(MID_Y - ra)}H${r(HOOP.x)}A${r(ra)} ${r(ra)} 0 0 0 ${r(HOOP.x)} ${r(MID_Y + ra)}H${r(BACKBOARD_X)}`,
    },
    { kind: 'board', d: `M${r(BACKBOARD_X)} ${r(MID_Y - COURT.backboardWidth / 2)}V${r(MID_Y + COURT.backboardWidth / 2)}` },
    { kind: 'rim', d: `M${r(BACKBOARD_X)} ${MID_Y}H${r(HOOP.x + rim)}` },
    { kind: 'rim', d: `M${r(HOOP.x + rim)} ${MID_Y}A${r(rim)} ${r(rim)} 0 1 0 ${r(HOOP.x - rim)} ${MID_Y}A${r(rim)} ${r(rim)} 0 1 0 ${r(HOOP.x + rim)} ${MID_Y}` },
  ];
}

export const COURT_LINES: readonly CourtLine[] = courtLines();

/** A rectangle of the court in feet, used as an SVG viewBox or a canvas source rect. */
export type CourtView = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The whole half court plus room for the boundary lines. */
export const FULL_COURT_VIEW: CourtView = { x: -0.6, y: -0.6, width: COURT.length + 1.2, height: COURT.width + 1.2 };

/**
 * A strip along the route, centred on the basket. It keeps the real scale, so the
 * free-throw circle stays round; `depth` is the strip's height in feet.
 */
export function laneView(depth: number): CourtView {
  return { x: -0.6, y: MID_Y - depth / 2, width: COURT.length + 1.2, height: depth };
}

export const viewBox = (view: CourtView) => `${view.x} ${view.y} ${view.width} ${view.height}`;
