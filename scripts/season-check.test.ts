import { describe, expect, it } from 'vitest';
import { MIN_LEAD_DAYS, MIN_OFFICIAL_DAYS, parseLaunchConfig, parseRollbackFrom, seasonChangeIssues } from './season-check.ts';
import { addDays } from '../src/engine/daily.ts';
import { readFileSync } from 'node:fs';

const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const days = run('2026-11-15', 80);

describe('launch-day release gate', () => {
  it('reads the committed config, which is beta (null) or a date', () => {
    expect(parseLaunchConfig("export const LAUNCH_DAY: string | null = null;")).toBeNull();
    expect(parseLaunchConfig("export const LAUNCH_DAY: string | null = '2026-12-02';")).toBe('2026-12-02');
    expect(parseLaunchConfig('nothing here')).toBeUndefined();
    expect(parseLaunchConfig(readFileSync('src/engine/launch-config.ts', 'utf8'))).not.toBeUndefined();
  });
  it('accepts scheduling a future official Day 1 with enough validated slates', () => {
    expect(seasonChangeIssues({ base: null, head: '2026-12-02', today: '2026-11-28', days })).toEqual([]);
  });
  it('refuses a launch today or in the past: never mid-day, never renumbering a live puzzle', () => {
    expect(seasonChangeIssues({ base: null, head: '2026-11-28', today: '2026-11-28', days }).join()).toMatch(/not in the future/);
    expect(seasonChangeIssues({ base: null, head: '2026-11-27', today: '2026-11-28', days }).join()).toMatch(/not in the future/);
  });
  it('refuses a day before the format-variety gate, or without enough runway', () => {
    expect(seasonChangeIssues({ base: null, head: '2026-11-29', today: '2026-11-20', days }).join()).toMatch(/VARIETY_FROM/);
    const short = run('2026-11-15', 30);
    expect(seasonChangeIssues({ base: null, head: '2026-12-02', today: '2026-11-28', days: short }).join()).toMatch(new RegExp(`need at least ${MIN_OFFICIAL_DAYS}`));
  });
  it('never moves or cancels a season that has started, except as an explicit emergency rollback', () => {
    expect(seasonChangeIssues({ base: '2026-12-02', head: '2026-12-05', today: '2026-12-03', days }).join()).toMatch(/cannot be moved/);
    expect(seasonChangeIssues({ base: '2026-12-02', head: null, today: '2026-12-03', days }).join()).toMatch(/cannot be moved/);
    expect(seasonChangeIssues({ base: '2026-12-02', head: null, today: '2026-12-03', days, rollback: true })).toEqual([]);
  });
  it('allows rescheduling or cancelling a launch that has not started', () => {
    expect(seasonChangeIssues({ base: '2026-12-02', head: '2026-12-05', today: '2026-11-30', days })).toEqual([]);
    expect(seasonChangeIssues({ base: '2026-12-02', head: null, today: '2026-11-30', days })).toEqual([]);
  });
  it(`needs at least ${MIN_LEAD_DAYS} days of lead so a late merge can't cross the boundary`, () => {
    expect(seasonChangeIssues({ base: null, head: '2026-12-02', today: '2026-12-01', days }).join()).toMatch(/days ahead/);
    expect(seasonChangeIssues({ base: null, head: '2026-12-03', today: '2026-12-01', days })).toEqual([]);
  });
  it('reads the committed rollback acknowledgement', () => {
    expect(parseRollbackFrom("export const SEASON_ROLLBACK_FROM: string | null = '2026-12-02';")).toBe('2026-12-02');
    expect(parseRollbackFrom("export const SEASON_ROLLBACK_FROM: string | null = null;")).toBeNull();
    expect(parseRollbackFrom('')).toBeNull();
  });
});
