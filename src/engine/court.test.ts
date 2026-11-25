import { describe, expect, it } from 'vitest';
import {
  BACKBOARD_X, CORNER_THREE_DISTANCE, COURT, COURT_LINES, FREE_THROW_X, FULL_COURT_VIEW, HALF_COURT_CENTER, HOOP,
  laneView, THREE_POINT_BREAK_X,
} from './court';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const half = COURT.line / 2;

describe('NBA half-court geometry (Rule No. 1)', () => {
  it('is a 47 × 50 ft half court with 2-inch lines', () => {
    expect(COURT.length).toBe(94 / 2);
    expect(COURT.width).toBe(50);
    expect(COURT.line).toBeCloseTo(2 / 12);
  });

  it('puts the basket centre 5 ft 3 in from the baseline, on the court’s centre line', () => {
    expect(COURT.length - BACKBOARD_X).toBe(4);
    expect(COURT.length - HOOP.x).toBeCloseTo(5.25);
    expect(HOOP).toEqual({ x: 41.75, y: 25 });
    expect(HALF_COURT_CENTER).toEqual({ x: 0, y: 25 });
  });

  it('places the free-throw line 15 ft from the backboard, 19 ft from the baseline', () => {
    expect(BACKBOARD_X - FREE_THROW_X).toBe(15);
    expect(COURT.length - FREE_THROW_X).toBe(19);
    const [lane] = COURT_LINES.filter(({ d }) => d.startsWith('M47 '));
    const [, top, ft, bottom] = numbers(lane!.d);
    // Outside edges are 16 ft apart; the far edge of the free-throw line is at 19 ft.
    expect((bottom! + half) - (top! - half)).toBeCloseTo(16);
    expect(ft! - half).toBeCloseTo(FREE_THROW_X);
  });

  it('draws a 23 ft 9 in arc that meets corner lines 3 ft from each sideline (22 ft from the basket)', () => {
    expect(CORNER_THREE_DISTANCE).toBe(22);
    expect(THREE_POINT_BREAK_X).toBeCloseTo(HOOP.x - Math.sqrt(23.75 ** 2 - 22 ** 2));
    const three = COURT_LINES.find(({ d }) => d.includes(`A${(23.75 - half).toFixed(3).replace(/0+$/, '')}`));
    expect(three).toBeDefined();
    const [, cornerTop, breakX, radius] = numbers(three!.d);
    expect(cornerTop! - half).toBeCloseTo(3);
    expect(radius! + half).toBeCloseTo(23.75);
    // The break point sits on the arc's centreline.
    expect(Math.hypot(breakX! - HOOP.x, cornerTop! - HOOP.y)).toBeCloseTo(radius!, 2);
  });

  it('draws the 4 ft restricted area, 6 ft free-throw circle and 12 ft centre circle', () => {
    const radii = COURT_LINES.flatMap(({ d }) => [...d.matchAll(/A(\d+(?:\.\d+)?) /g)].map((m) => Number(m[1])));
    expect(radii).toEqual(expect.arrayContaining([
      Number((4 + half).toFixed(3)),
      Number((6 - half).toFixed(3)),
    ]));
    const center = COURT_LINES.find(({ d }) => d.startsWith('M0 ') && d.includes('A'));
    expect(numbers(center!.d)[2]! + half).toBeCloseTo(6);
  });

  it('frames the whole court without distortion, and lane strips at real scale', () => {
    expect(FULL_COURT_VIEW.width - COURT.length).toBeCloseTo(FULL_COURT_VIEW.height - COURT.width);
    const strip = laneView(12);
    expect(strip.height).toBe(12);
    expect(strip.y + strip.height / 2).toBe(HOOP.y);
    expect(strip.x).toBeLessThan(0);
    expect(strip.x + strip.width).toBeGreaterThan(COURT.length);
  });
});
