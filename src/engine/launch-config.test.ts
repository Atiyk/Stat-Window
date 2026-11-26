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
  it('allows beta, a future launch, and later deploys of a season already live', () => {
    expect(activationIssue({ launchDay: null, previous: null, today: L })).toBeNull();
    expect(activationIssue({ launchDay: L, previous: null, today: '2026-11-30' })).toBeNull();
    expect(activationIssue({ launchDay: L, previous: L, today: '2026-12-05' })).toBeNull();
  });
  it('refuses the build that first activates a launch day that has already begun', () => {
    expect(activationIssue({ launchDay: L, previous: null, today: L })).toMatch(/mid-day/);
    expect(activationIssue({ launchDay: L, previous: '2026-12-03', today: '2026-12-02' })).toMatch(/mid-day/);
  });
  it('refuses when the previous commit cannot be read and the day has begun', () => {
    expect(activationIssue({ launchDay: L, previous: undefined, today: L })).toMatch(/could not be read/);
    expect(activationIssue({ launchDay: L, previous: undefined, today: '2026-11-30' })).toBeNull();
  });
});
