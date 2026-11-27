import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeUrl } from '../engine/challenge';
import { courtRunCheckpoints } from '../engine/court-run';
import type { ShotAttempt } from '../engine/shot-chart';
import { cardBlob, weeklyCardBlob, type CardFormat, type CardInput } from './share-card';
import type { WeeklyCardModel } from '../engine/weekly';

const host = 'stat-window.vercel.app';
const day = '2026-11-24';
const puzzleUrl = challengeUrl(`https://${host}`, day);
const rounds = [80, 0, 0, 0, 74].map((points) => ({ points, hit: points > 0 }));
const attempts: ShotAttempt[] = [
  { number: 1, potential: 80, earned: 80, outcome: 'made', x: 27.3, y: 6.1 },
  { number: 2, potential: 100, earned: 0, outcome: 'missed', x: 16.8, y: 12.3 },
  { number: 3, potential: null, earned: 0, outcome: 'timeout', x: 2.5, y: 25 },
  { number: 4, potential: 0, earned: 0, outcome: 'zero', x: 35.5, y: 28.2 },
  { number: 5, potential: 74, earned: 74, outcome: 'made', x: 28.7, y: 43.2 },
];

const noop = () => {};
function mockCanvas() {
  const words: string[] = [];
  const baselines: number[] = [];
  const scales: [number, number][] = [];
  const context = {
    fillText: (value: string, _x: number, y: number) => { words.push(value); baselines.push(y); },
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
    clip: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: (x: number, y: number) => scales.push([x, y]),
  };
  const png = new Blob(['png'], { type: 'image/png' });
  const canvas = {
    width: 0,
    height: 0,
    /** The size the canvas had when it was encoded (it is released afterwards). */
    encoded: null as null | [number, number],
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => { canvas.encoded = [canvas.width, canvas.height]; callback(png); }),
  };
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => canvas });
  vi.stubGlobal('Path2D', class {});
  return { canvas, png, words, scales, baselines };
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
      markers: ['Court Run', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', '80', '+80', '+0', '+74', '154', `${host}/?day=${day}`],
    },
  ];
  it.each(styles)('draws the $card.style PNG with the correct score, puzzle, and result type', async ({ card, markers }) => {
    const { canvas, png, words, scales, baselines } = mockCanvas();
    expect(await cardBlob(card)).toBe(png);
    // The court is never stretched: one factor for both axes.
    for (const [x, y] of scales) expect(x).toBe(y);
    // Portrait cards keep every line of text clear of story overlays at the top and bottom.
    if (format === 'portrait' && card.style !== 'classic') {
      expect(Math.min(...baselines.filter((y) => y > 60))).toBeGreaterThanOrEqual(250);
      expect(Math.max(...baselines.filter((y) => y > 60))).toBeLessThanOrEqual(1560);
    }
    if (card.style !== 'classic') expect(scales.length).toBeGreaterThan(0);
    expect(canvas.encoded).toEqual([1080, height]);
    // The backing store is released once the PNG exists (iOS caps total canvas memory).
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
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

describe('weekly scorecard image', () => {
  const model: WeeklyCardModel = {
    range: 'Nov 30 – Dec 6, 2026',
    total: 1234,
    max: 3500,
    completed: 4,
    gamesLine: '4 of 7 games played',
    days: [
      { weekday: 'Mon', date: 'Nov 30', mark: 'score', value: '412', note: null, fill: 0.824 },
      { weekday: 'Tue', date: 'Dec 1', mark: 'unplayed', value: '–', note: 'not played', fill: 0 },
      { weekday: 'Wed', date: 'Dec 2', mark: 'zero', value: '0', note: 'played', fill: 0 },
      { weekday: 'Thu', date: 'Dec 3', mark: 'score', value: '435', note: null, fill: 0.87 },
      { weekday: 'Fri', date: 'Dec 4', mark: 'unavailable', value: '?', note: 'unavailable', fill: 0 },
      { weekday: 'Sat', date: 'Dec 5', mark: 'score', value: '387', note: null, fill: 0.774 },
      { weekday: 'Sun', date: 'Dec 6', mark: 'future', value: '', note: 'to come', fill: 0 },
    ],
    best: { weekday: 'Thu', points: 435 },
    average: 309,
    invite: 'Same daily five for everyone. Play along.',
    host,
  };

  it.each<{ format: CardFormat; height: number }>([
    { format: 'square', height: 1080 },
    { format: 'portrait', height: 1920 },
  ])('draws the $format week with dates, total, maximum, every day, best day, average and invitation', async ({ format, height }) => {
    const { canvas, png, words, baselines } = mockCanvas();
    expect(await weeklyCardBlob(model, format)).toBe(png);
    expect(canvas.encoded).toEqual([1080, height]);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    // A note too wide for its box is drawn as two lines, so read the words in order.
    const text = words.join(' ');
    for (const marker of ['Stat Window', 'Weekly scorecard', 'Nov 30 – Dec 6, 2026', '1,234', 'of 3,500', '4 of 7 games played',
      'Mon', 'Sun', 'Nov 30', 'Dec 6', '412', '435', '387', '–', 'not played', 'played', '?', 'unavailable', 'to come',
      'Best day', 'Thu 435', 'Average', '309', 'Same daily five for everyone. Play along.', host]) {
      expect(text).toContain(marker);
    }
    // Everything sits on the card, and portrait keeps clear of story overlays.
    const lowest = format === 'portrait' ? 250 : 60;
    expect(Math.min(...baselines)).toBeGreaterThanOrEqual(lowest);
    expect(Math.max(...baselines)).toBeLessThanOrEqual(format === 'portrait' ? 1660 : 1040);
  });

  it('marks a launch week’s days before the season and today in words', async () => {
    const { words } = mockCanvas();
    const launch: WeeklyCardModel = {
      ...model,
      days: model.days.map((d, i) => (i < 2 ? { ...d, mark: 'prelaunch', value: '', note: 'not open' } : i === 2 ? { ...d, mark: 'open', value: '', note: 'today' } : d)),
    };
    await weeklyCardBlob(launch, 'square');
    expect(words.join(' ').match(/not open/g)).toHaveLength(2);
    expect(words).toContain('today');
  });

  it('returns null when the image cannot be made', async () => {
    const { canvas } = mockCanvas();
    canvas.toBlob.mockImplementation((callback) => callback(null));
    expect(await weeklyCardBlob(model, 'square')).toBeNull();
  });
});

describe('classic card invitation', () => {
  const card = { label: 'No. 9', date: 'Nov 24', format: 'square', context: null, style: 'classic', host } as const;
  const lineOf = async (input: CardInput) => {
    const { words } = mockCanvas();
    await cardBlob(input);
    return words.filter((w) => /Beat|Your turn/.test(w));
  };
  it('matches the share text: “Think you know ball? Beat N.”', async () => {
    expect(await lineOf({ ...card, results: rounds })).toEqual(['Think you know ball? Beat 154.']);
  });
  it('a zero score or an untimed run gets the same line as the text', async () => {
    const zero = rounds.map(() => ({ points: 0, hit: false }));
    expect(await lineOf({ ...card, results: zero })).toEqual(['Same five questions. Your turn.']);
    expect(await lineOf({ ...card, results: rounds, untimed: true })).toEqual(['Same five questions. Your turn.']);
  });
});
