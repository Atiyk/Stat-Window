import { describe, expect, it } from 'vitest';
import { assertLaunchEnv, LAUNCH_DAY } from './launch-config';

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
