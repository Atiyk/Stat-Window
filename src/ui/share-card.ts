/**
 * Spoiler-free score card, drawn in the browser on a <canvas> (no service, no upload).
 * It carries the brand, the public puzzle number, the total, one mark per round and
 * an invitation. Never an answer, a window, a question or tomorrow's anything.
 * The percentile line appears only when the caller passes a verified, gated result.
 */
import type { RoundRecord } from '../engine/game';

export type CardInput = {
  label: string; // "No. 4" or "Beta No. 4"
  date: string; // "Nov 18"
  results: readonly RoundRecord[];
  percentile?: { label: string; detail: string } | null;
  host: string; // "stat-window.vercel.app"
};

const C = {
  paper: '#f7f5ee',
  surface: '#fffdf9',
  ink: '#20312b',
  soft: '#5b6c63',
  brand: '#2f614d',
  band: '#c8ddcd',
  accent: '#cf775f',
  line: '#dde2da',
};

export const CARD_SIZE = 1080;

/** What each round's tile shows: points band only, the same information as the share-text squares. */
export function tileKind(r: RoundRecord): 'miss' | 'high' | 'mid' | 'low' {
  if (!r.hit) return 'miss';
  if (r.points >= 75) return 'high';
  if (r.points >= 40) return 'mid';
  return 'low';
}

export function drawCard(ctx: CanvasRenderingContext2D, input: CardInput): void {
  const S = CARD_SIZE;
  const total = input.results.reduce((s, r) => s + r.points, 0);
  const display = "'Fraunces Variable', Georgia, serif";
  const sans = "'DM Sans Variable', system-ui, sans-serif";
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, S, S);

  // Wordmark
  ctx.fillStyle = C.brand;
  ctx.fillRect(96, 104, 12, 64);
  ctx.fillRect(96, 104, 26, 12);
  ctx.fillRect(96, 156, 26, 12);
  ctx.fillRect(170, 104, 12, 64);
  ctx.fillRect(156, 104, 26, 12);
  ctx.fillRect(156, 156, 26, 12);
  ctx.fillRect(134, 120, 12, 32);
  ctx.fillStyle = C.ink;
  ctx.font = `600 58px ${display}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Stat Window', 210, 158);
  ctx.fillStyle = C.soft;
  ctx.font = `500 40px ${sans}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${input.label} · ${input.date}`, S - 96, 156);
  ctx.textAlign = 'left';

  // Score
  ctx.fillStyle = C.brand;
  ctx.font = `600 300px ${sans}`;
  const scoreText = String(total);
  ctx.fillText(scoreText, 90, 520);
  const w = ctx.measureText(scoreText).width;
  ctx.fillStyle = C.soft;
  ctx.font = `500 60px ${sans}`;
  ctx.fillText('of 500', 90 + w + 28, 520);

  // One tile per round
  const tile = 156;
  const gap = 24;
  const x0 = 96;
  const y0 = 580;
  input.results.forEach((r, i) => {
    const x = x0 + i * (tile + gap);
    const kind = tileKind(r);
    ctx.lineWidth = 6;
    if (kind === 'miss') {
      ctx.fillStyle = C.surface;
      ctx.fillRect(x, y0, tile, tile);
      ctx.strokeStyle = C.accent;
      ctx.setLineDash([16, 12]);
      ctx.strokeRect(x + 3, y0 + 3, tile - 6, tile - 6);
      ctx.setLineDash([]);
      ctx.fillStyle = C.accent;
      ctx.font = `600 56px ${sans}`;
      ctx.textAlign = 'center';
      ctx.fillText('0', x + tile / 2, y0 + tile / 2 + 20);
    } else {
      ctx.fillStyle = kind === 'high' ? C.brand : kind === 'mid' ? '#5f8a76' : C.band;
      ctx.fillRect(x, y0, tile, tile);
      ctx.fillStyle = kind === 'low' ? C.ink : '#ffffff';
      ctx.font = `600 56px ${sans}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(r.points), x + tile / 2, y0 + tile / 2 + 20);
    }
    ctx.textAlign = 'left';
  });

  // Percentile (only when verified and gated) and the invitation
  let y = 870;
  if (input.percentile) {
    ctx.fillStyle = C.ink;
    ctx.font = `600 46px ${sans}`;
    ctx.fillText(input.percentile.label, 96, 820);
    ctx.fillStyle = C.soft;
    ctx.font = `400 34px ${sans}`;
    ctx.fillText(input.percentile.detail, 96, 866);
    y = 945;
  }
  ctx.fillStyle = C.ink;
  ctx.font = `600 54px ${display}`;
  ctx.fillText(total > 0 ? `Same five questions. Beat ${total}?` : 'Same five questions. Your turn.', 96, y);
  ctx.fillStyle = C.soft;
  ctx.font = `500 34px ${sans}`;
  ctx.fillText(input.host, 96, S - 44);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(96, S - 96);
  ctx.lineTo(S - 96, S - 96);
  ctx.stroke();
}

/** PNG of the card, or null when canvas isn't available (old browsers, blocked). */
export async function cardBlob(input: CardInput): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined') return null;
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_SIZE;
    canvas.height = CARD_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawCard(ctx, input);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}
