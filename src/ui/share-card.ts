/**
 * Spoiler-free score card, drawn in the browser on a <canvas> (no service, no upload).
 * It carries the brand, the public puzzle number, the total, one mark per round and
 * an invitation. Never an answer, a window, a question or tomorrow's anything.
 * The percentile line appears only when the caller passes a verified, gated result.
 */
import { COURT_LINES, FULL_COURT_VIEW, PAINT } from '../engine/court';
import {
  CHECKPOINT_RADIUS, COURT_END, COURT_START, courtCheckpointMarker, courtPosition, type CourtCheckpoint,
} from '../engine/court-run';
import type { RoundRecord } from '../engine/game';
import { SHOT_MARKER_RADIUS, SHOT_OUTCOME_LABELS, SHOT_UNSUBMITTED_DIVIDER, SHOT_UNSUBMITTED_SPAN, type ShotAttempt } from '../engine/shot-chart';
import { MAX_TOTAL, formatAnswerTime, inviteLine } from '../engine/summary';
import { drawSymbol } from '../brand/symbol';
import type { WeeklyCardDay, WeeklyCardModel } from '../engine/weekly';

export type CardFormat = 'square' | 'portrait';
export type CardStyle = 'classic' | 'shot-chart' | 'court-run';

type CardHeading = {
  format?: CardFormat;
  label: string; // "No. 4" or "Beta No. 4"
  date: string; // "Nov 18"
  context?: 'Practice' | 'Untimed practice' | 'Challenge' | 'Past daily' | null;
};

type ClassicCard = CardHeading & {
  style?: 'classic';
  untimed?: boolean;
  results: readonly Pick<RoundRecord, 'hit' | 'points'>[];
  percentile?: { label: string; detail: string } | null;
  answerMs?: number | null;
  host: string;
};

type CourtCard = CardHeading & {
  total: number;
  puzzleUrl: string;
} & (
  | { style: 'shot-chart'; attempts: readonly ShotAttempt[] }
  | { style: 'court-run'; checkpoints: readonly CourtCheckpoint[] }
);

export type CardInput = ClassicCard | CourtCard;

// Garden Classic: jersey cream, garden navy, basketball copper (and tints of them).
const C = {
  paper: '#F7F4EE',
  surface: '#FCFAF6',
  ink: '#132A47',
  soft: '#4E5F73',
  brand: '#17365D',
  band: '#B9C6D6',
  bandSoft: '#E1E6EC',
  line: 'rgba(19, 42, 71, 0.16)',
  courtLine: '#97A2AF',
  paint: '#EBEEF1',
  rim: '#17365D',
  brandSoft: '#E3E8EE',
  brandPress: '#0F2744',
  copper: '#B94B21',
  /** Muted type on the navy footer (about 6:1 on brand). */
  onBrandSoft: '#C3CEDB',
};

export const CARD_SIZE = 1080;
export const PORTRAIT_HEIGHT = 1920;

/** What each round's tile shows: points band only, the same information as the share-text squares. */
export function tileKind(r: ClassicCard['results'][number]): 'miss' | 'high' | 'mid' | 'low' {
  if (!r.hit) return 'miss';
  if (r.points >= 75) return 'high';
  if (r.points >= 40) return 'mid';
  return 'low';
}

const SANS = "'DM Sans Variable', system-ui, sans-serif";

function drawWordmark(ctx: CanvasRenderingContext2D, headerY: number): void {
  // The symbol, then the name as separate text: the artwork never contains lettering.
  drawSymbol(ctx, 92, headerY - 4, 72, { line: C.brand, ball: C.copper });
  ctx.fillStyle = C.ink;
  ctx.font = `850 58px ${SANS}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Stat Window', 186, headerY + 54);
}

function drawClassicCard(ctx: CanvasRenderingContext2D, input: ClassicCard): void {
  const S = CARD_SIZE;
  const portrait = input.format === 'portrait';
  const height = portrait ? PORTRAIT_HEIGHT : S;
  const headerY = portrait ? 296 : 104;
  const scoreY = portrait ? 830 : 520;
  const footerY = portrait ? 1640 : S - 44;
  const total = input.results.reduce((s, r) => s + r.points, 0);
  const sans = SANS;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, S, height);

  drawWordmark(ctx, headerY);
  ctx.fillStyle = C.soft;
  ctx.font = `500 40px ${sans}`;
  ctx.textAlign = portrait ? 'left' : 'right';
  ctx.fillText(`${input.label} · ${input.date}`, portrait ? 96 : S - 96, headerY + (portrait ? 133 : 52));
  ctx.textAlign = 'left';

  // Score
  ctx.fillStyle = C.brand;
  ctx.font = `760 300px ${sans}`;
  const scoreText = String(total);
  ctx.fillText(scoreText, 90, scoreY);
  const w = ctx.measureText(scoreText).width;
  ctx.fillStyle = C.soft;
  ctx.font = `500 60px ${sans}`;
  ctx.fillText(`of ${MAX_TOTAL}`, 90 + w + 28, scoreY);

  const time = input.answerMs != null ? `Answer time ${formatAnswerTime(input.answerMs)}` : null;
  const detail = input.untimed ? 'Untimed practice' : [input.context, time].filter(Boolean).join(' · ');
  if (detail) {
    ctx.fillStyle = C.soft;
    ctx.font = `600 34px ${sans}`;
    ctx.fillText(detail, 96, scoreY + 38);
  }

  // One tile per round
  const tile = 156;
  const gap = 24;
  const x0 = 96;
  const y0 = portrait ? 935 : 580;
  input.results.forEach((r, i) => {
    const x = x0 + i * (tile + gap);
    const kind = tileKind(r);
    ctx.lineWidth = 6;
    if (kind === 'miss') {
      ctx.fillStyle = C.surface;
      ctx.fillRect(x, y0, tile, tile);
      ctx.strokeStyle = C.soft;
      ctx.setLineDash([16, 12]);
      ctx.strokeRect(x + 3, y0 + 3, tile - 6, tile - 6);
      ctx.setLineDash([]);
      ctx.fillStyle = C.soft;
      ctx.font = `600 56px ${sans}`;
      ctx.textAlign = 'center';
      ctx.fillText('0', x + tile / 2, y0 + tile / 2 + 20);
    } else {
      ctx.fillStyle = kind === 'high' ? C.brand : kind === 'mid' ? C.band : C.bandSoft;
      ctx.fillRect(x, y0, tile, tile);
      ctx.fillStyle = kind === 'high' ? C.paper : C.ink;
      ctx.font = `600 56px ${sans}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(r.points), x + tile / 2, y0 + tile / 2 + 20);
    }
    ctx.textAlign = 'left';
  });

  // Percentile (only when verified and gated) and the invitation
  let y = portrait ? 1390 : 870;
  if (input.percentile) {
    ctx.fillStyle = C.ink;
    ctx.font = `600 46px ${sans}`;
    const percentileY = portrait ? 1190 : 820;
    ctx.fillText(input.percentile.label, 96, percentileY);
    ctx.fillStyle = C.soft;
    ctx.font = `400 34px ${sans}`;
    ctx.fillText(input.percentile.detail, 96, percentileY + 46);
    y = portrait ? 1440 : 945;
  }
  ctx.fillStyle = C.ink;
  ctx.font = `850 54px ${sans}`;
  ctx.fillText(inviteLine(total, input.untimed), 96, y);
  ctx.fillStyle = C.soft;
  ctx.font = `500 34px ${sans}`;
  ctx.fillText(input.host, 96, footerY);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(96, footerY - 52);
  ctx.lineTo(S - 96, footerY - 52);
  ctx.stroke();
}

/** Court art in feet, scaled uniformly to `width` pixels: the same lines and positions as the app. */
function drawCourt(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, card: CourtCard): number {
  const view = FULL_COURT_VIEW;
  const scale = width / view.width;
  const px = 1 / scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-view.x, -view.y);

  // The court's own boundary is the frame: no second border around it.
  ctx.fillStyle = C.surface;
  ctx.fillRect(view.x, view.y, view.width, view.height);
  ctx.fillStyle = C.paint;
  ctx.fillRect(PAINT.x, PAINT.y, PAINT.width, PAINT.height);

  ctx.lineCap = 'butt';
  for (const { d, kind } of COURT_LINES) {
    ctx.strokeStyle = kind === 'rim' ? C.rim : kind === 'board' ? C.ink : C.courtLine;
    ctx.lineWidth = (kind === 'boundary' ? 3.2 : kind === 'board' ? 4 : kind === 'rim' ? 2.8 : 2.2) * px;
    ctx.setLineDash(kind === 'dashed' ? [6 * px, 6 * px] : []);
    ctx.stroke(new Path2D(d));
  }
  ctx.setLineDash([]);

  if (card.style === 'court-run') {
    drawRoute(ctx, card.total, card.checkpoints, px);
  } else {
    if (card.attempts.some((attempt) => attempt.potential === null)) {
      ctx.beginPath();
      ctx.strokeStyle = C.courtLine;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.moveTo(SHOT_UNSUBMITTED_DIVIDER, SHOT_UNSUBMITTED_SPAN[0]);
      ctx.lineTo(SHOT_UNSUBMITTED_DIVIDER, SHOT_UNSUBMITTED_SPAN[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const attempt of card.attempts) drawAttempt(ctx, attempt, px);
  }
  ctx.restore();
  return view.height * scale;
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, px: number): void {
  const r = 1.15;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = C.copper;
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3 * px;
  ctx.stroke();
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  ctx.stroke();
}

function drawRoute(ctx: CanvasRenderingContext2D, total: number, checkpoints: readonly CourtCheckpoint[], px: number): void {
  const start = COURT_START;
  const end = COURT_END;
  const final = courtPosition(total);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.strokeStyle = C.courtLine;
  ctx.lineWidth = 2.5 * px;
  ctx.setLineDash([2 * px, 8 * px]);
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (total > 0) {
    ctx.beginPath();
    ctx.strokeStyle = C.brand;
    ctx.lineWidth = 6 * px;
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(final.x, final.y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 1.45px ${SANS}`;
  // Every stem first, so no stem ever crosses another round's label.
  ctx.lineWidth = 2.4 * px;
  ctx.strokeStyle = C.brand;
  for (const checkpoint of checkpoints) {
    const label = courtCheckpointMarker(checkpoint);
    ctx.beginPath();
    ctx.moveTo(checkpoint.x, checkpoint.y);
    ctx.lineTo(label.x, label.y);
    ctx.stroke();
  }
  for (const checkpoint of checkpoints) {
    const label = courtCheckpointMarker(checkpoint);
    ctx.beginPath();
    ctx.arc(label.x, label.y, CHECKPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.lineWidth = 2.8 * px;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.fillText(String(checkpoint.number), label.x, label.y + .05);
  }
  drawBall(ctx, final.x, final.y, px);
}

function drawAttempt(ctx: CanvasRenderingContext2D, { x, y, outcome, number }: ShotAttempt, px: number): void {
  const r = SHOT_MARKER_RADIUS;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (outcome === 'zero') {
    ctx.moveTo(0, -r * 1.2);
    ctx.lineTo(r * 1.2, 0);
    ctx.lineTo(0, r * 1.2);
    ctx.lineTo(-r * 1.2, 0);
    ctx.closePath();
  } else if (outcome === 'timeout' || outcome === 'unavailable') {
    ctx.roundRect(-r * .9, -r * .9, r * 1.8, r * 1.8, .25);
  } else {
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
  }
  ctx.fillStyle = outcome === 'made' ? C.brand : outcome === 'zero' ? C.brandSoft : C.surface;
  ctx.fill();
  ctx.lineWidth = (outcome === 'missed' ? 4 : 3) * px;
  ctx.strokeStyle = outcome === 'made' || outcome === 'zero' ? C.brandPress : C.ink;
  if (outcome === 'timeout') ctx.setLineDash([6 * px, 4 * px]);
  if (outcome === 'unavailable') ctx.setLineDash([2 * px, 4 * px]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 1.55px ${SANS}`;
  ctx.fillStyle = outcome === 'made' ? C.surface : C.ink;
  ctx.fillText(String(number), 0, .05);
  ctx.restore();
}

function roundColumns(input: CourtCard): { number: number; value: string; note: string; quiet: boolean }[] {
  return input.style === 'court-run'
    ? input.checkpoints.map(({ number, total }, i) => ({
        number, value: String(total), note: `+${total - (input.checkpoints[i - 1]?.total ?? 0)}`, quiet: false,
      }))
    : input.attempts.map(({ number, outcome, potential }) => ({
        number, value: potential === null ? '–' : String(potential), note: SHOT_OUTCOME_LABELS[outcome],
        // A missed window keeps its value but never looks like points scored.
        quiet: outcome !== 'made',
      }));
}

function drawCourtCard(ctx: CanvasRenderingContext2D, input: CourtCard): void {
  const portrait = input.format === 'portrait';
  const height = portrait ? PORTRAIT_HEIGHT : CARD_SIZE;
  const courtRun = input.style === 'court-run';
  const title = courtRun ? 'Court Run' : 'Shot Chart';
  const caption = courtRun ? ['How far the points', 'carried the ball'] : ['Farther out means', 'a bolder window'];
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, CARD_SIZE, height);

  // Portrait keeps clear of story overlays at the top and bottom.
  const headerY = portrait ? 248 : 72;
  drawWordmark(ctx, headerY);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.soft;
  ctx.font = `500 36px ${SANS}`;
  ctx.fillText([input.label, input.date, input.context].filter(Boolean).join(' · '), 96, headerY + 116, 888);

  const scoreY = portrait ? headerY + 300 : headerY + 290;
  ctx.fillStyle = C.brand;
  ctx.font = `790 ${portrait ? 150 : 132}px ${SANS}`;
  const score = String(input.total);
  ctx.fillText(score, 88, scoreY);
  const scoreWidth = ctx.measureText(score).width;
  ctx.fillStyle = C.soft;
  ctx.font = `600 ${portrait ? 46 : 40}px ${SANS}`;
  ctx.fillText(`of ${MAX_TOTAL}`, 104 + scoreWidth, scoreY);

  const columns = roundColumns(input);
  if (portrait) {
    ctx.fillStyle = C.ink;
    ctx.font = `760 44px ${SANS}`;
    ctx.fillText(title, 96, scoreY + 76);
    const titleWidth = ctx.measureText(title).width;
    ctx.fillStyle = C.soft;
    ctx.font = `500 32px ${SANS}`;
    ctx.fillText(caption.join(' '), 96 + titleWidth + 20, scoreY + 76, 888 - titleWidth - 20);

    const courtWidth = 560;
    const courtY = scoreY + 112;
    const courtHeight = drawCourt(ctx, (CARD_SIZE - courtWidth) / 2, courtY, courtWidth, input);
    const roundsY = courtY + courtHeight + 56;
    const columnWidth = (CARD_SIZE - 192) / 5;
    ctx.textAlign = 'center';
    for (const { number, value, note, quiet } of columns) {
      const cx = 96 + columnWidth * (number - .5);
      ctx.fillStyle = C.soft;
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText(`Q${number}`, cx, roundsY);
      ctx.fillStyle = quiet ? C.soft : C.ink;
      ctx.font = `${quiet ? 600 : 760} ${quiet ? 34 : 44}px ${SANS}`;
      ctx.fillText(value, cx, roundsY + 50, columnWidth - 8);
      ctx.fillStyle = C.soft;
      ctx.font = `500 24px ${SANS}`;
      ctx.fillText(note, cx, roundsY + 84, columnWidth - 8);
    }
    ctx.textAlign = 'left';
    drawFooter(ctx, roundsY + 120, input.puzzleUrl);
    return;
  }

  // Square: the court is the hero on the right, the story of each round on the left.
  ctx.fillStyle = C.ink;
  ctx.font = `760 46px ${SANS}`;
  ctx.fillText(title, 96, scoreY + 82);
  ctx.fillStyle = C.soft;
  ctx.font = `500 30px ${SANS}`;
  ctx.fillText(caption[0]!, 96, scoreY + 124, 350);
  ctx.fillText(caption[1]!, 96, scoreY + 160, 350);

  const courtWidth = 500;
  drawCourt(ctx, CARD_SIZE - 84 - courtWidth, headerY + 140, courtWidth, input);

  const listY = scoreY + 236;
  columns.forEach(({ number, value, note, quiet }, i) => {
    const rowY = listY + i * 54;
    ctx.fillStyle = C.soft;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(`Q${number}`, 96, rowY);
    ctx.fillStyle = quiet ? C.soft : C.ink;
    ctx.font = `${quiet ? 600 : 760} ${quiet ? 30 : 36}px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.fillText(value, 236, rowY);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.soft;
    ctx.font = `500 30px ${SANS}`;
    ctx.fillText(note, 260, rowY, 200);
  });
  drawFooter(ctx, CARD_SIZE - 160, input.puzzleUrl);
}

function drawFooter(ctx: CanvasRenderingContext2D, dividerY: number, puzzleUrl: string): void {
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(96, dividerY);
  ctx.lineTo(CARD_SIZE - 96, dividerY);
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.font = `850 48px ${SANS}`;
  ctx.fillText('Five questions. Your turn.', 96, dividerY + 62, 888);
  ctx.fillStyle = C.soft;
  ctx.font = `500 34px ${SANS}`;
  ctx.fillText(puzzleUrl.replace(/^https?:\/\//, ''), 96, dividerY + 110, 888);
}

export function drawCard(ctx: CanvasRenderingContext2D, input: CardInput): void {
  if (input.style === 'shot-chart' || input.style === 'court-run') {
    drawCourtCard(ctx, input);
  } else {
    drawClassicCard(ctx, input);
  }
}

const num = (n: number) => n.toLocaleString('en-US');

/** One day's column. Shape and words carry the state; colour only reinforces it. */
function drawWeekDay(ctx: CanvasRenderingContext2D, d: WeeklyCardDay, x: number, top: number, w: number, h: number, big: boolean): void {
  const inset = 3;
  ctx.save();
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  if (d.mark === 'score' || d.mark === 'zero') {
    ctx.fillStyle = C.bandSoft;
    ctx.fillRect(x, top, w, h);
    const bar = d.mark === 'score' ? Math.max(10, d.fill * h) : 0;
    ctx.fillStyle = C.brand;
    ctx.fillRect(x, top + h - bar, w, bar);
    // A played zero keeps a solid floor line: finished, not missing.
    ctx.fillRect(x, top + h - 8, w, 8);
  } else if (d.mark === 'prelaunch') {
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.rect(x, top, w, h);
    ctx.clip();
    ctx.lineWidth = 3;
    for (let k = -h; k < w; k += 22) { ctx.moveTo(x + k, top + h); ctx.lineTo(x + k + h, top); }
    ctx.stroke();
  } else {
    ctx.strokeStyle = d.mark === 'open' ? C.brand : C.soft;
    if (d.mark === 'unplayed' || d.mark === 'unavailable') ctx.setLineDash([14, 10]);
    if (d.mark === 'future') { ctx.strokeStyle = C.courtLine; ctx.setLineDash([3, 10]); ctx.lineCap = 'round'; }
    ctx.strokeRect(x + inset, top + inset, w - inset * 2, h - inset * 2);
  }
  ctx.restore();

  const cx = x + w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (d.note) {
    // The state's word sits inside its box, so a glance at a thumbnail still separates them.
    ctx.fillStyle = d.mark === 'zero' ? C.ink : C.soft;
    const size = big ? 26 : 22;
    ctx.font = `600 ${size}px ${SANS}`;
    // Two short lines rather than squeezed type when the word is wider than the box.
    const lines = ctx.measureText(d.note).width > w - 16 && d.note.includes(' ') ? d.note.split(' ') : [d.note];
    lines.forEach((line, k) => ctx.fillText(line, cx, top + h / 2 + 8 + (k - (lines.length - 1) / 2) * size * 1.15, w - 12));
  }
  const valueY = top + h + (big ? 64 : 52);
  ctx.fillStyle = d.mark === 'score' || d.mark === 'zero' ? C.ink : C.soft;
  ctx.font = `${d.mark === 'score' || d.mark === 'zero' ? 800 : 600} ${big ? 48 : 40}px ${SANS}`;
  if (d.value) ctx.fillText(d.value, cx, valueY, w);
  ctx.fillStyle = C.ink;
  ctx.font = `700 ${big ? 32 : 26}px ${SANS}`;
  ctx.fillText(d.weekday, cx, valueY + (big ? 46 : 38), w);
  ctx.fillStyle = C.soft;
  ctx.font = `500 ${big ? 26 : 22}px ${SANS}`;
  ctx.fillText(d.date, cx, valueY + (big ? 80 : 66), w);
  ctx.textAlign = 'left';
}

/** The Weekly Scoreboard as a spoiler-free image: dates, daily scores, the total and the count behind it. */
export function drawWeeklyCard(ctx: CanvasRenderingContext2D, card: WeeklyCardModel, format: CardFormat = 'square'): void {
  const portrait = format === 'portrait';
  const S = CARD_SIZE;
  const L = portrait
    // Portrait fills the story safe area (y 250–1660) from the wordmark to the host line; the
    // navy footer runs on to the bottom edge, so the band under the story overlay is not dead paper.
    ? { header: 252, kicker: 412, range: 480, total: 708, games: 784, bars: 840, barH: 400, divider: 1436, stats: 1520, invite: 1592, host: 1648 }
    : { header: 88, kicker: 236, range: 290, total: 436, games: 510, bars: 556, barH: 170, divider: 874, stats: 926, invite: 984, host: 1030 };
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, S, portrait ? PORTRAIT_HEIGHT : S);
  drawWordmark(ctx, L.header);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.soft;
  ctx.font = `600 34px ${SANS}`;
  ctx.fillText('Weekly scorecard', 96, L.kicker);
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${portrait ? 56 : 50}px ${SANS}`;
  ctx.fillText(card.range, 96, L.range, S - 192);

  ctx.fillStyle = C.brand;
  ctx.font = `790 ${portrait ? 220 : 148}px ${SANS}`;
  const total = num(card.total);
  ctx.fillText(total, 88, L.total);
  const w = ctx.measureText(total).width;
  ctx.fillStyle = C.soft;
  ctx.font = `600 ${portrait ? 54 : 46}px ${SANS}`;
  ctx.fillText(`of ${num(card.max)}`, 88 + w + 24, L.total, S - 200 - w);
  ctx.fillStyle = C.ink;
  ctx.font = `700 ${portrait ? 42 : 36}px ${SANS}`;
  ctx.fillText(card.gamesLine, 96, L.games, S - 192);

  const gap = portrait ? 16 : 14;
  const colW = (S - 192 - gap * 6) / 7;
  card.days.forEach((d, i) => drawWeekDay(ctx, d, 96 + i * (colW + gap), L.bars, colW, L.barH, portrait));

  if (portrait) {
    ctx.fillStyle = C.brand;
    ctx.fillRect(0, L.divider, S, PORTRAIT_HEIGHT - L.divider);
  } else {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(96, L.divider);
    ctx.lineTo(S - 96, L.divider);
    ctx.stroke();
  }
  // On the navy footer: cream type, and a muted label tone that keeps 4.5:1.
  const footInk = portrait ? C.paper : C.ink;
  const footSoft = portrait ? C.onBrandSoft : C.soft;

  // Best day and average, only when there is a completed game to describe.
  const stats: [string, string][] = [];
  if (card.best) stats.push(['Best day', `${card.best.weekday} ${num(card.best.points)}`]);
  if (card.average !== null) stats.push(['Average', `${num(card.average)} per game`]);
  let sx = 96;
  for (const [label, value] of stats) {
    ctx.fillStyle = footSoft;
    ctx.font = `600 ${portrait ? 34 : 30}px ${SANS}`;
    ctx.fillText(label, sx, L.stats);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = footInk;
    ctx.font = `800 ${portrait ? 40 : 34}px ${SANS}`;
    ctx.fillText(value, sx + lw + 14, L.stats);
    sx += lw + 14 + ctx.measureText(value).width + 48;
  }

  ctx.fillStyle = footInk;
  ctx.font = `850 ${portrait ? 46 : 40}px ${SANS}`;
  ctx.fillText(card.invite, 96, L.invite, S - 192);
  ctx.fillStyle = footSoft;
  ctx.font = `500 32px ${SANS}`;
  ctx.fillText(card.host, 96, L.host, S - 192);
}

async function toPng(height: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob | null> {
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof document === 'undefined') return null;
    await document.fonts?.ready;
    canvas = document.createElement('canvas');
    canvas.width = CARD_SIZE;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    draw(ctx);
    const c = canvas;
    return await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  } finally {
    // Release the backing store now: iOS Safari caps total canvas memory per page.
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** PNG of the weekly scorecard, or null when canvas isn't available. */
export function weeklyCardBlob(card: WeeklyCardModel, format: CardFormat = 'square'): Promise<Blob | null> {
  return toPng(format === 'portrait' ? PORTRAIT_HEIGHT : CARD_SIZE, (ctx) => drawWeeklyCard(ctx, card, format));
}

/** PNG of the card, or null when canvas isn't available (old browsers, blocked). */
export function cardBlob(input: CardInput): Promise<Blob | null> {
  return toPng(input.format === 'portrait' ? PORTRAIT_HEIGHT : CARD_SIZE, (ctx) => drawCard(ctx, input));
}
