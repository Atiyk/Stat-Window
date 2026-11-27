import { describe, expect, it } from 'vitest';
import { activationIssue, assertLaunchEnv, LAUNCH_DAY } from './launch-config';

describe('committed launch day', () => {
  it('fails a build whose environment still names a different launch day', () => {
    expect(() => assertLaunchEnv({ VITE_LAUNCH_DAY: '1999-01-01' })).toThrow(/disagrees/);
    expect(() => assertLaunchEnv({ LAUNCH_DAY: '1999-01-01' })).toThrow(/disagrees/);
    expect(() => assertLaunchEnv({})).not.toThrow();
    expect(() => assertLaunchEnv({ VITE_LAUNCH_DAY: '' })).not.toThrow();
    const day = LAUNCH_DAY;
    if (day) expect(() => assertLaunchEnv({ VITE_LAUNCH_DAY: day, LAUNCH_DAY: day })).not.toThrow();
  });
});

describe('production build activation guard', () => {
  const L = '2026-12-01';
  it('allows beta, a future launch, and any deploy once production already serves the season', () => {
    expect(activationIssue({ launchDay: null, deployed: null, today: L })).toBeNull();
    expect(activationIssue({ launchDay: L, deployed: null, today: '2026-11-30' })).toBeNull();
    expect(activationIssue({ launchDay: L, deployed: L, today: '2026-12-05' })).toBeNull();
    expect(activationIssue({ launchDay: L, deployed: L, today: L })).toBeNull(); // a redeploy on L
  });
  it('refuses any build that would switch a begun launch day on, whichever commit carries it', () => {
    expect(activationIssue({ launchDay: L, deployed: null, today: L })).toMatch(/mid-day/);
    expect(activationIssue({ launchDay: L, deployed: null, today: '2026-12-02' })).toMatch(/mid-day/);
    expect(activationIssue({ launchDay: L, deployed: '2026-12-03', today: '2026-12-02' })).toMatch(/mid-day/);
  });
  it('refuses when production cannot be read, unless explicitly acknowledged', () => {
    expect(activationIssue({ launchDay: L, deployed: undefined, today: L })).toMatch(/could not be read/);
    expect(activationIssue({ launchDay: L, deployed: undefined, today: L, ack: L })).toBeNull();
    expect(activationIssue({ launchDay: L, deployed: undefined, today: '2026-11-30' })).toBeNull();
  });
  it('allows the first advance only from the prior production schedule before the cutoff', () => {
    const o = { launchDay: '2026-11-28', today: '2026-11-27', now: Date.parse('2026-11-28T00:59:59Z') };
    const deadline = Date.parse('2026-11-28T01:00:00Z');
    expect(activationIssue({ ...o, deployed: '2026-11-30' })).toBeNull();
    expect(activationIssue({ ...o, deployed: null })).toMatch(/must still serve/);
    expect(activationIssue({ ...o, deployed: undefined })).toMatch(/must still serve/);
    expect(activationIssue({ ...o, now: deadline, deployed: '2026-11-30' })).toMatch(/cutoff/);
    expect(activationIssue({ ...o, now: deadline, deployed: '2026-11-28' })).toBeNull();
    expect(activationIssue({ ...o, now: deadline, today: '2026-11-28', deployed: undefined, ack: '2026-11-28' })).toMatch(/cutoff/);
  });
});
