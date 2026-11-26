import { describe, expect, it } from 'vitest';
import { COURT } from '../engine/court';
import { BRAND_SVGS } from './assets';
import { GARDEN, SYMBOL, symbolSvg } from './symbol';

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
    expect(SYMBOL.ball.cy + SYMBOL.ball.r).toBeLessThanOrEqual(62);
    const arcBottom = 6 + (COURT.backboardFromBaseline + COURT.rimFromBackboard + COURT.rimInnerRadius + COURT.threePointRadius) * 1.08;
    expect(SYMBOL.ball.cy - SYMBOL.ball.r - (arcBottom + SYMBOL.arc.width / 2)).toBeGreaterThan(1);
  });

  it('is symbol only: no text, no gradients, no filters, only Garden Classic colours', () => {
    for (const svg of [...Object.values(BRAND_SVGS), symbolSvg({ line: GARDEN.navy, ball: GARDEN.copper, tile: GARDEN.cream })]) {
      expect(svg).not.toMatch(/<text|<tspan|Gradient|<filter|<image/i);
      const colours = svg.match(/#[0-9A-Fa-f]{6}/g) ?? [];
      for (const c of colours) expect(Object.values(GARDEN)).toContain(c);
    }
  });

});
