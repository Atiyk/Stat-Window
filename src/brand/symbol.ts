import { COURT } from '../engine/court.ts';

/**
 * The Stat Window symbol (Garden Classic, Court Geometry). This module is the
 * canonical artwork: the header mark, the share cards, the favicon, the PWA and
 * Apple icons and the social image are all drawn from these paths.
 *
 * It is the scoring end of a real NBA half court, seen from above with the
 * baseline at the top: the three-point line (corner lines 3 ft from the sidelines,
 * a 23 ft 9 in arc around the basket centre 5 ft 3 in from the baseline) and the
 * 16 ft lane, 19 ft deep, all at one uniform scale from src/engine/court.ts. A
 * copper ball sits on the lane's axis just outside the arc, on its way in: the
 * game's run from half court to the basket.
 *
 * Simplified for 16 px: no rim, backboard or free-throw circle, which merge into
 * the arc below about 48 px. Lettering never appears in the artwork.
 */

export const SYMBOL_VIEWBOX = 64;
export const GARDEN = { cream: '#F7F4EE', navy: '#17365D', copper: '#B94B21' } as const;

const SCALE = 1.08; // px per foot, so the 50 ft court width spans 54 of 64 px
const TOP = 6; // baseline centreline
const LINE = 6; // baseline and arc weight
const LANE = 5; // lane weight
const BALL = 6.4;
const GAP = 1.6;

const round = (n: number) => Math.round(n * 100) / 100;
const X = (ft: number) => round(32 - (COURT.width / 2) * SCALE + ft * SCALE);
const Y = (ft: number) => round(TOP + ft * SCALE);

const hoopFromBaseline = COURT.backboardFromBaseline + COURT.rimFromBackboard + COURT.rimInnerRadius;
const cornerLength = hoopFromBaseline + Math.sqrt(COURT.threePointRadius ** 2 - (COURT.width / 2 - COURT.cornerThreeFromSideline) ** 2);
const arcR = round(COURT.threePointRadius * SCALE);
const left = X(COURT.cornerThreeFromSideline);
const right = X(COURT.width - COURT.cornerThreeFromSideline);
const laneL = X((COURT.width - COURT.laneWidth) / 2);
const laneR = X((COURT.width + COURT.laneWidth) / 2);
const arcBottom = TOP + (hoopFromBaseline + COURT.threePointRadius) * SCALE;

export const SYMBOL = {
  baseline: { d: `M${X(0) + 1} ${Y(0)}H${X(COURT.width) - 1}`, width: LINE },
  arc: { d: `M${left} ${Y(0)}V${Y(cornerLength)}A${arcR} ${arcR} 0 0 0 ${right} ${Y(cornerLength)}V${Y(0)}`, width: LINE },
  lane: { d: `M${laneL} ${Y(0)}V${Y(COURT.freeThrowFromBaseline)}H${laneR}V${Y(0)}`, width: LANE },
  ball: { cx: 32, cy: round(arcBottom + LINE / 2 + GAP + BALL), r: BALL },
} as const;

export type SymbolColors = { line: string; ball: string; tile?: string | undefined; tileRadius?: number };

/** The symbol as a standalone SVG document. `tile` adds a solid square behind it (app icons); `inset` shrinks the art for maskable safe zones. */
export function symbolSvg({ line, ball, tile, tileRadius = 14 }: SymbolColors, inset = 1): string {
  const art = [
    `<path d="${SYMBOL.baseline.d}" fill="none" stroke="${line}" stroke-width="${SYMBOL.baseline.width}" stroke-linecap="round"/>`,
    `<path d="${SYMBOL.lane.d}" fill="none" stroke="${line}" stroke-width="${SYMBOL.lane.width}" stroke-linejoin="round"/>`,
    `<path d="${SYMBOL.arc.d}" fill="none" stroke="${line}" stroke-width="${SYMBOL.arc.width}" stroke-linejoin="round"/>`,
    `<circle cx="${SYMBOL.ball.cx}" cy="${SYMBOL.ball.cy}" r="${SYMBOL.ball.r}" fill="${ball}"/>`,
  ].join('');
  const body = inset === 1 ? art : `<g transform="translate(32 32) scale(${inset}) translate(-32 -32)">${art}</g>`;
  const bg = tile ? `<rect width="64" height="64" rx="${tileRadius}" fill="${tile}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SYMBOL_VIEWBOX} ${SYMBOL_VIEWBOX}">${bg}${body}</svg>\n`;
}

/** Draws the symbol on a canvas at (x, y) with the given size in px. */
export function drawSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colors: { line: string; ball: string }): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / SYMBOL_VIEWBOX, size / SYMBOL_VIEWBOX);
  ctx.strokeStyle = colors.line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of [SYMBOL.baseline, SYMBOL.lane, SYMBOL.arc]) {
    ctx.lineWidth = part.width;
    ctx.lineCap = part === SYMBOL.baseline ? 'round' : 'butt';
    ctx.stroke(new Path2D(part.d));
  }
  ctx.fillStyle = colors.ball;
  ctx.beginPath();
  ctx.arc(SYMBOL.ball.cx, SYMBOL.ball.cy, SYMBOL.ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
