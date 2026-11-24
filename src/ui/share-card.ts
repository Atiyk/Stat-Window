/**
 * Spoiler-free score card, drawn in the browser on a <canvas> (no service, no upload).
 * It carries the brand, the public puzzle number, the total, one mark per round and
 * an invitation. Never an answer, a window, a question or tomorrow's anything.
 * The percentile line appears only when the caller passes a verified, gated result.
 */
import {
  COURT_HEIGHT, COURT_HOOP, COURT_LINES, COURT_START, COURT_WIDTH,
  courtCheckpointMarkerY, courtPosition, type CourtCheckpoint,
} from '../engine/court-run';
import type { RoundRecord } from '../engine/game';
import { SHOT_MARKER_RADIUS, SHOT_OUTCOME_LABELS, SHOT_UNSUBMITTED_DIVIDER, type ShotAttempt } from '../engine/shot-chart';
import { MAX_TOTAL, formatAnswerTime } from '../engine/summary';

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

const C = {
  paper: '#F7F6F2',
  surface: '#FDFCF9',
  ink: '#202525',
  soft: '#505B58',
  brand: '#347967',
  band: '#B8D5C9',
  bandSoft: '#E0ECE7',
  line: 'rgba(32, 37, 37, 0.16)',
  courtLine: '#A2ABA4',
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
  const sans = SANS;
  ctx.fillStyle = C.brand;
  ctx.fillRect(96, headerY, 12, 64);
  ctx.fillRect(96, headerY, 26, 12);
  ctx.fillRect(96, headerY + 52, 26, 12);
  ctx.fillRect(170, headerY, 12, 64);
  ctx.fillRect(156, headerY, 26, 12);
  ctx.fillRect(156, headerY + 52, 26, 12);
  ctx.fillRect(134, headerY + 16, 12, 32);
  ctx.fillStyle = C.ink;
  ctx.font = `850 58px ${sans}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Stat Window', 210, headerY + 54);
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
  ctx.fillText(total > 0 && !input.untimed ? `Same five questions. Beat ${total}?` : 'Same five questions. Your turn.', 96, y);
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

function drawCourt(ctx: CanvasRenderingContext2D, y: number, card: CourtCard): void {
  const width = CARD_SIZE - 168;
  const scale = width / COURT_WIDTH;
  ctx.save();
  ctx.translate(84, y);
  ctx.scale(scale, scale);

  ctx.beginPath();
  ctx.roundRect(0, 0, COURT_WIDTH, COURT_HEIGHT, 10);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = C.courtLine;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (const path of COURT_LINES) ctx.stroke(new Path2D(path));

  if (card.style === 'court-run') {
    drawRoute(ctx, card.total, card.checkpoints);
  } else {
    if (card.attempts.some((attempt) => attempt.potential === null)) {
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.moveTo(SHOT_UNSUBMITTED_DIVIDER, 26);
      ctx.lineTo(SHOT_UNSUBMITTED_DIVIDER, COURT_HEIGHT - 26);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const attempt of card.attempts) drawAttempt(ctx, attempt);
  }
  ctx.restore();
}

function drawRoute(ctx: CanvasRenderingContext2D, total: number, checkpoints: readonly CourtCheckpoint[]): void {
  const final = courtPosition(total);
  ctx.beginPath();
  ctx.strokeStyle = C.courtLine;
  ctx.setLineDash([3, 4]);
  ctx.moveTo(COURT_START.x, COURT_START.y);
  ctx.lineTo(COURT_HOOP.x, COURT_HOOP.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.strokeStyle = C.brand;
  ctx.lineWidth = 3;
  ctx.moveTo(COURT_START.x, COURT_START.y);
  ctx.lineTo(final.x, final.y);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `780 10px ${SANS}`;
  for (const checkpoint of checkpoints) {
    const markerY = courtCheckpointMarkerY(checkpoint);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = C.brand;
    ctx.beginPath();
    ctx.moveTo(checkpoint.x, checkpoint.y);
    ctx.lineTo(checkpoint.x, markerY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(checkpoint.x, markerY, 8.5, 0, 2 * Math.PI);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.fillText(String(checkpoint.number), checkpoint.x, markerY + 0.5);
  }

  ctx.beginPath();
  ctx.arc(final.x, final.y, 9, 0, 2 * Math.PI);
  ctx.fillStyle = C.brand;
  ctx.fill();
  ctx.strokeStyle = C.surface;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawAttempt(ctx: CanvasRenderingContext2D, { x, y, outcome, number }: ShotAttempt): void {
  const radius = SHOT_MARKER_RADIUS;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (outcome === 'zero') {
    ctx.moveTo(0, -12);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-12, 0);
    ctx.closePath();
  } else if (outcome === 'timeout') {
    ctx.roundRect(-9, -9, 18, 18, 2);
  } else {
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
  }
  ctx.fillStyle = outcome === 'made' ? C.brand : C.surface;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = outcome === 'made' ? C.brand : C.ink;
  if (outcome === 'timeout') ctx.setLineDash([3, 2]);
  if (outcome === 'unavailable') ctx.setLineDash([1, 2]);
  ctx.stroke();
  ctx.fillStyle = outcome === 'made' ? C.surface : C.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `780 10px ${SANS}`;
  ctx.fillText(String(number), 0, 0.5);
  ctx.restore();
}

function drawCourtCard(ctx: CanvasRenderingContext2D, input: CourtCard): void {
  const portrait = input.format === 'portrait';
  const headerY = portrait ? 248 : 62;
  const scoreY = portrait ? 620 : 304;
  const courtY = portrait ? 705 : 339;
  const roundsY = portrait ? 1230 : 830;
  const dividerY = portrait ? 1380 : 903;
  const invitationY = portrait ? 1479 : 962;
  const linkY = portrait ? 1540 : 1013;
  const right = CARD_SIZE - 96;
  const courtRun = input.style === 'court-run';
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, CARD_SIZE, portrait ? PORTRAIT_HEIGHT : CARD_SIZE);
  drawWordmark(ctx, headerY);

  ctx.fillStyle = C.soft;
  ctx.font = `500 36px ${SANS}`;
  ctx.fillText([input.label, input.date, input.context].filter(Boolean).join(' · '), 96, headerY + 111, 888);
  ctx.fillStyle = C.brand;
  ctx.font = `790 150px ${SANS}`;
  const score = String(input.total);
  ctx.fillText(score, 87, scoreY);
  const scoreWidth = ctx.measureText(score).width;
  ctx.fillStyle = C.soft;
  ctx.font = `600 46px ${SANS}`;
  ctx.fillText(`of ${MAX_TOTAL}`, 104 + scoreWidth, scoreY);

  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink;
  ctx.font = `750 57px ${SANS}`;
  ctx.fillText(courtRun ? 'Court Run' : 'Shot Chart', right, scoreY - 42);
  ctx.fillStyle = C.soft;
  ctx.font = `500 32px ${SANS}`;
  ctx.fillText(courtRun ? 'Progress by points earned' : 'Farther means more potential points', right, scoreY, 428);
  ctx.textAlign = 'left';

  drawCourt(ctx, courtY, input);

  const columns = input.style === 'court-run'
    ? input.checkpoints.map(({ number, total }) => ({ number, value: String(total) }))
    : input.attempts.map(({ number, outcome }) => ({ number, value: SHOT_OUTCOME_LABELS[outcome] }));
  ctx.textAlign = 'center';
  const columnWidth = (CARD_SIZE - 192) / 5;
  for (const { number, value } of columns) {
    const x = 96 + columnWidth * (number - 0.5);
    ctx.fillStyle = C.soft;
    ctx.font = `600 29px ${SANS}`;
    ctx.fillText(`Q${number}`, x, roundsY);
    ctx.fillStyle = C.ink;
    ctx.font = `720 ${courtRun ? 44 : 27}px ${SANS}`;
    ctx.fillText(value, x, roundsY + (portrait ? 49 : 41), columnWidth - 7);
  }
  ctx.textAlign = 'left';

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(96, dividerY);
  ctx.lineTo(right, dividerY);
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.font = `850 48px ${SANS}`;
  ctx.fillText('Five questions. Your turn.', 96, invitationY, 888);
  ctx.fillStyle = C.soft;
  ctx.font = `500 35px ${SANS}`;
  ctx.fillText(input.puzzleUrl.replace(/^https?:\/\//, ''), 96, linkY, 888);
}

export function drawCard(ctx: CanvasRenderingContext2D, input: CardInput): void {
  if (input.style === 'shot-chart' || input.style === 'court-run') {
    drawCourtCard(ctx, input);
  } else {
    drawClassicCard(ctx, input);
  }
}

/** PNG of the card, or null when canvas isn't available (old browsers, blocked). */
export async function cardBlob(input: CardInput): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined') return null;
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_SIZE;
    canvas.height = input.format === 'portrait' ? PORTRAIT_HEIGHT : CARD_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawCard(ctx, input);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}
