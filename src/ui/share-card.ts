/**
 * Spoiler-free score card, drawn in the browser on a <canvas> (no service, no upload).
 * It carries the brand, the public puzzle number, the total, one mark per round and
 * an invitation. Never an answer, a window, a question or tomorrow's anything.
 * The percentile line appears only when the caller passes a verified, gated result.
 */
import type { RoundRecord } from '../engine/game';
import { MAX_TOTAL, formatAnswerTime } from '../engine/summary';

export type CardFormat = 'square' | 'portrait';

export type CardInput = {
  format?: CardFormat;
  untimed?: boolean;
  label: string; // "No. 4" or "Beta No. 4"
  date: string; // "Nov 18"
  results: readonly RoundRecord[];
  percentile?: { label: string; detail: string } | null;
  answerMs?: number | null;
  host: string; // "stat-window.vercel.app"
};

const C = {
  paper: '#F7F6F2',
  surface: '#FDFCF9',
  ink: '#202525',
  soft: '#505B58',
  brand: '#347967',
  band: '#B8D5C9',
  bandSoft: '#E0ECE7',
  line: 'rgba(32, 37, 37, 0.16)',
};

export const CARD_SIZE = 1080;
export const PORTRAIT_HEIGHT = 1920;

/** What each round's tile shows: points band only, the same information as the share-text squares. */
export function tileKind(r: RoundRecord): 'miss' | 'high' | 'mid' | 'low' {
  if (!r.hit) return 'miss';
  if (r.points >= 75) return 'high';
  if (r.points >= 40) return 'mid';
  return 'low';
}

export function drawCard(ctx: CanvasRenderingContext2D, input: CardInput): void {
  const S = CARD_SIZE;
  const portrait = input.format === 'portrait';
  const height = portrait ? PORTRAIT_HEIGHT : S;
  const headerY = portrait ? 296 : 104;
  const scoreY = portrait ? 830 : 520;
  const footerY = portrait ? 1640 : S - 44;
  const total = input.results.reduce((s, r) => s + r.points, 0);
  const sans = "'DM Sans Variable', system-ui, sans-serif";
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, S, height);

  // Wordmark
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

  const detail = input.untimed ? 'Untimed practice' : input.answerMs != null ? `Answer time ${formatAnswerTime(input.answerMs)}` : null;
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
