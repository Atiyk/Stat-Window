import { describe, expect, it } from 'vitest';
import { eventPath, survivalBand } from '../lib/track';
import { armFor, exposedYesterday, EXPERIMENT_KEY, markExposed } from './experiment';
import { parseFlag, previewAsOf, wantsSurvival } from './flag';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('flag', () => {
  it('anything but preview or on is off', () => {
    expect(parseFlag(undefined)).toBe('off');
    expect(parseFlag('true')).toBe('off');
    expect(parseFlag('on')).toBe('on');
  });
  it('asof is honoured only by preview builds, and only as a real date', () => {
    expect(previewAsOf('?survival&asof=2027-01-10', 'preview')).toBe('2027-01-10');
    expect(previewAsOf('?survival&asof=2027-01-10', 'on')).toBeNull();
    expect(previewAsOf('?survival&asof=2027-01-10', 'off')).toBeNull();
    expect(previewAsOf('?survival&asof=2027-13-45', 'preview')).toBeNull();
  });
  it('?survival does nothing while off', () => {
    expect(wantsSurvival('?survival', 'off')).toBe(false);
    expect(wantsSurvival('?survival', 'on')).toBe(true);
  });
});

describe('survival events', () => {
  it('fixed paths only', () => {
    expect(eventPath({ name: 'survival_start', source: 'again' })).toBe('/e/survival/start/again');
    expect(eventPath({ name: 'survival_end', round: 1, reason: 'miss' })).toBe('/e/survival/end/r1-4/miss');
    expect(eventPath({ name: 'survival_end', round: 20, reason: 'short' })).toBe('/e/survival/end/r17-20/short');
    expect(eventPath({ name: 'survival_reach', round: 10 })).toBe('/e/survival/reach/r10');
    expect(eventPath({ name: 'experiment', arm: 'control', step: 'next-day-start' })).toBe('/e/x/survival-cta/control/next-day-start');
    expect([1, 4, 5, 8, 9, 13, 16, 17, 20, 99].map(survivalBand)).toEqual(['r1-4', 'r1-4', 'r5-8', 'r5-8', 'r9-12', 'r13-16', 'r13-16', 'r17-20', 'r17-20', 'r17-20']);
  });
});

describe('experiment', () => {
  it('no arm when not running or without storage', () => {
    expect(armFor(mem(), false)).toBeNull();
    expect(armFor(null, true)).toBeNull();
  });
  it('assigns once and keeps it', () => {
    const s = mem();
    expect(armFor(s, true, () => 0.1)).toBe('cta');
    expect(armFor(s, true, () => 0.9)).toBe('cta');
    expect(armFor(mem(), true, () => 0.9)).toBe('control');
  });
  it('exposure counts once per day and marks the next day as a return', () => {
    const s = mem();
    armFor(s, true, () => 0.9);
    expect(markExposed(s, '2026-12-10')).toBe(true);
    expect(markExposed(s, '2026-12-10')).toBe(false);
    expect(exposedYesterday(s, '2026-12-11')).toBe(true);
    expect(exposedYesterday(s, '2026-12-12')).toBe(false);
  });
  it('a garbled arm is ignored and reassigned', () => {
    const s = mem();
    s.setItem(EXPERIMENT_KEY, '{"arm":"vip"}');
    expect(armFor(s, true, () => 0.1)).toBe('cta');
  });
});
