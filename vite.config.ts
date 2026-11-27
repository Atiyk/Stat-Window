import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { scoresApi } from './server/dev-plugin.ts';
import { activationIssue, assertLaunchEnv, LAUNCH_DAY, NOVEMBER_LAUNCH_ADVANCE } from './src/engine/launch-config.ts';
import { puzzleDay } from './src/engine/daily.ts';

// The launch day is committed; a leftover dashboard variable that disagrees fails the deploy.
assertLaunchEnv(process.env);

/** The launch day production serves now, from its /launch.json; undefined when unreadable. */
async function deployedLaunchDay(): Promise<string | null | undefined> {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'stat-window.vercel.app';
  try {
    const res = await fetch(`https://${host}/launch.json`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const v = ((await res.json()) as { launchDay?: unknown }).launchDay;
    return v === null || typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * /launch.json: the deployed launch day, so a tab that was opened before the deploy that
 * scheduled the season can notice at the midnight rollover and reload (src/App.tsx).
 */
const launchManifest = (): Plugin => ({
  name: 'stat-window-launch-manifest',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'launch.json', source: JSON.stringify({ launchDay: LAUNCH_DAY }) });
  },
});

export default defineConfig(async ({ command }) => {
  // Vercel deploys main without waiting for CI, so the production build guards the
  // launch boundary itself (docs/LAUNCH.md): never switch the season on mid-day, and
  // never ship the launch preview switch.
  if (command === 'build' && process.env.VERCEL_ENV === 'production') {
    if (process.env.VITE_LAUNCH_PREVIEW) throw new Error('VITE_LAUNCH_PREVIEW is set in a production build; the launch preview is for non-production builds only.');
    const mustCheckProduction = LAUNCH_DAY !== null
      && (LAUNCH_DAY === NOVEMBER_LAUNCH_ADVANCE.to || LAUNCH_DAY <= puzzleDay(new Date()));
    if (process.env.LAUNCH_GUARD_ACK) console.warn(`LAUNCH_GUARD_ACK=${process.env.LAUNCH_GUARD_ACK} is set: delete it from the Vercel environment after this one deploy (docs/LAUNCH.md).`);
    if (mustCheckProduction) {
      const deployed = await deployedLaunchDay();
      const now = new Date();
      const issue = activationIssue({ launchDay: LAUNCH_DAY, deployed, today: puzzleDay(now), now: now.getTime(), ack: process.env.LAUNCH_GUARD_ACK });
      if (issue) throw new Error(issue);
    }
  }
  return {
    plugins: [react(), scoresApi(), launchManifest()],
    build: { target: 'es2022', sourcemap: false },
  };
});
