/**
 * The official season's launch day, the single source of truth for the client label,
 * the score API's season and the CI release gates (docs/LAUNCH.md).
 *
 * `null` keeps the public beta. Setting a date schedules the restarted official season:
 * that canonical Eastern day becomes "No. 1" at 12:00 AM Eastern. It is changed only by a
 * reviewed commit, and `scripts/season-check.ts` refuses a change unless the new day is
 * still in the future (Eastern), is on or after VARIETY_FROM and has enough validated
 * official slates. The old VITE_LAUNCH_DAY / LAUNCH_DAY environment variables are no
 * longer read; a build fails if either is set to a different value, so a stale
 * dashboard setting can never split the client and server seasons.
 */
export const LAUNCH_DAY: string | null = null;

/** Throws when a deployment environment still carries a launch day that disagrees with the commit. */
export function assertLaunchEnv(env: Readonly<Record<string, string | undefined>>): void {
  for (const name of ['VITE_LAUNCH_DAY', 'LAUNCH_DAY'] as const) {
    const v = env[name]?.trim();
    if (v && v !== LAUNCH_DAY) {
      throw new Error(`${name}=${v} disagrees with LAUNCH_DAY=${String(LAUNCH_DAY)} in src/engine/launch-config.ts. Remove the variable; the launch day is committed.`);
    }
  }
}
