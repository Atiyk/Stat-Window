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
export const LAUNCH_DAY: string | null = '2026-11-30';

/**
 * Emergency rollback acknowledgement, committed like the launch day: set it to the
 * started launch day that is being cancelled, in the same commit that sets LAUNCH_DAY
 * back to null. The season check accepts cancelling a started season only when this
 * names it, so the step is reviewable and needs no CI secret. Leave null otherwise.
 */
export const SEASON_ROLLBACK_FROM: string | null = null;

/**
 * The production build's own guard against switching on part-way through a day.
 * Vercel deploys main without waiting for CI, so a launch commit merged after midnight
 * Eastern on (or after) its launch day would renumber a day already being played.
 * `deployed` is the launch day production serves right now (its /launch.json), or
 * `undefined` when that could not be read. Once a launch day has begun, a build is
 * allowed only if production already serves that same day (the season went live at the
 * boundary from an earlier deploy); otherwise it would be the one switching it on
 * mid-day, whichever commit carries it. `ack` is an explicit override for an unreadable
 * production (LAUNCH_GUARD_ACK=<L>, docs/LAUNCH.md).
 */
export function activationIssue(o: { launchDay: string | null; deployed: string | null | undefined; today: string; ack?: string | undefined }): string | null {
  const { launchDay, deployed, today } = o;
  if (launchDay === null || launchDay > today) return null;
  if (deployed === launchDay) return null;
  if (deployed === undefined) {
    if (o.ack === launchDay) return null;
    return `LAUNCH_DAY ${launchDay} has begun (today is ${today} Eastern) and production's /launch.json could not be read, so this build might switch the season on mid-day. Refusing to build (override: LAUNCH_GUARD_ACK=${launchDay}, docs/LAUNCH.md).`;
  }
  return `LAUNCH_DAY ${launchDay} has already begun (today is ${today} Eastern) but production serves ${String(deployed)}: deploying would switch the season on mid-day. Choose a future launch day.`;
}

/** Throws when a deployment environment still carries a launch day that disagrees with the commit. */
export function assertLaunchEnv(env: Readonly<Record<string, string | undefined>>): void {
  for (const name of ['VITE_LAUNCH_DAY', 'LAUNCH_DAY'] as const) {
    const v = env[name]?.trim();
    if (v && v !== LAUNCH_DAY) {
      throw new Error(`${name}=${v} disagrees with LAUNCH_DAY=${String(LAUNCH_DAY)} in src/engine/launch-config.ts. Remove the variable; the launch day is committed.`);
    }
  }
}
