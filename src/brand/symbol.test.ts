import { describe, expect, it } from 'vitest';
import { COURT } from '../engine/court';
import { BRAND_SVGS } from './assets';
import { GARDEN, SYMBOL, SYMBOL_SCALE, SYMBOL_TOP, symbolSvg } from './symbol';

const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('the Court Geometry symbol', () => {
  it('keeps real NBA proportions at one uniform scale', () => {
    const [laneL, , , laneR] = nums(SYMBOL.lane.d);
    const [baseL, , baseR] = nums(SYMBOL.baseline.d);
    const laneWidth = laneR! - laneL!;
    const courtWidth = baseR! - baseL! + 2; // the baseline is inset 1 px at each round cap
    expect(laneWidth / courtWidth).toBeCloseTo(COURT.laneWidth / COURT.width, 2);
    const arcR = nums(SYMBOL.arc.d)[3]!;
    expect(arcR / courtWidth).toBeCloseTo(COURT.threePointRadius / COURT.width, 2);
  });

  it('stays inside its 64 px box, with the ball clear of the arc', () => {
    expect(SYMBOL.ball.cy + SYMBOL.ball.r).toBeLessThanOrEqual(60);
    // Optically centred: the art's top (baseline cap) and bottom (ball) are equally far from the edges.
    const top = SYMBOL_TOP - SYMBOL.baseline.width / 2;
    expect(Math.abs(top - (64 - (SYMBOL.ball.cy + SYMBOL.ball.r)))).toBeLessThan(1.5);
    const arcBottom = SYMBOL_TOP + (COURT.backboardFromBaseline + COURT.rimFromBackboard + COURT.rimInnerRadius + COURT.threePointRadius) * SYMBOL_SCALE;
    // Four units: one whole pixel at 16 px.
    expect(SYMBOL.ball.cy - SYMBOL.ball.r - (arcBottom + SYMBOL.arc.width / 2)).toBeGreaterThanOrEqual(4);
  });

  it('is symbol only: no text, no gradients, no filters, only Garden Classic colours', () => {
    for (const svg of [...Object.values(BRAND_SVGS), symbolSvg({ line: GARDEN.navy, ball: GARDEN.copper, tile: GARDEN.cream })]) {
      expect(svg).not.toMatch(/<text|<tspan|Gradient|<filter|<image/i);
      const colours = svg.match(/#[0-9A-Fa-f]{6}/g) ?? [];
      for (const c of colours) expect(Object.values(GARDEN)).toContain(c);
    }
  });

});
