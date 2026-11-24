import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeUrl } from '../engine/challenge';
import { courtRunCheckpoints } from '../engine/court-run';
import type { ShotAttempt } from '../engine/shot-chart';
import { cardBlob, type CardFormat, type CardInput } from './share-card';

const host = 'stat-window.vercel.app';
const day = '2026-11-24';
const puzzleUrl = challengeUrl(`https://${host}`, day);
const rounds = [80, 0, 0, 0, 74].map((points) => ({ points, hit: points > 0 }));
const attempts: ShotAttempt[] = [
  { number: 1, potential: 80, earned: 80, outcome: 'made', x: 101, y: 90 },
  { number: 2, potential: 100, earned: 0, outcome: 'missed', x: 70, y: 39 },
  { number: 3, potential: null, earned: 0, outcome: 'timeout', x: 36, y: 141 },
  { number: 4, potential: 0, earned: 0, outcome: 'zero', x: 255, y: 64 },
  { number: 5, potential: 74, earned: 74, outcome: 'made', x: 116, y: 116 },
];

const noop = () => {};
function mockCanvas() {
  const words: string[] = [];
  const context = {
    fillText: (value: string) => words.push(value),
    measureText: (value: string) => ({ width: value.length * 30 }),
    fillRect: noop,
    strokeRect: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    roundRect: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
  };
  const png = new Blob(['png'], { type: 'image/png' });
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(png)),
  };
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => canvas });
  vi.stubGlobal('Path2D', class {});
  return { canvas, png, words };
}

afterEach(() => vi.unstubAllGlobals());

describe.each<{ format: CardFormat; height: number }>([
  { format: 'square', height: 1080 },
  { format: 'portrait', height: 1920 },
])('$format exports', ({ format, height }) => {
  const puzzle = { label: 'No. 9', date: 'Nov 24', format, context: 'Practice' } as const;
  const styles: { card: CardInput; markers: string[] }[] = [
    { card: { ...puzzle, style: 'classic', host, results: rounds }, markers: ['Practice', '80', '74', host] },
    {
      card: { ...puzzle, style: 'shot-chart', total: 154, puzzleUrl, attempts },
      markers: ['Shot Chart', 'Scored', 'Missed', 'Timeout', '0-point catch', `${host}/?day=${day}`],
    },
    {
      card: { ...puzzle, style: 'court-run', total: 154, puzzleUrl, checkpoints: courtRunCheckpoints(rounds) },
      markers: ['Court Run', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', '80', `${host}/?day=${day}`],
    },
  ];
  it.each(styles)('draws the $card.style PNG with the correct score, puzzle, and result type', async ({ card, markers }) => {
    const { canvas, png, words } = mockCanvas();
    expect(await cardBlob(card)).toBe(png);
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(height);
    expect(words).toEqual(expect.arrayContaining([
      'Stat Window', '154', 'of 500',
      ...markers,
    ]));
    expect(words.join(' ')).toContain('No. 9 · Nov 24');
    expect(words.join(' ')).toContain('Practice');
    expect(words.join(' ')).not.toContain('today');
  });
});

it('returns unavailable when PNG export fails', async () => {
  const { canvas } = mockCanvas();
  canvas.toBlob.mockImplementation((callback) => callback(null));
  const input: CardInput = { label: 'No. 9', date: 'Nov 24', host, results: rounds };
  expect(await cardBlob(input)).toBeNull();
});
