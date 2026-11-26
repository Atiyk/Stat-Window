import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { scoresApi } from './server/dev-plugin.ts';
import { activationIssue, assertLaunchEnv, LAUNCH_DAY } from './src/engine/launch-config.ts';
import { puzzleDay } from './src/engine/daily.ts';
import { parseLaunchConfig } from './scripts/season-check.ts';

// The launch day is committed; a leftover dashboard variable that disagrees fails the deploy.
assertLaunchEnv(process.env);

/** LAUNCH_DAY at the commit before HEAD, or undefined when git can't tell (no history). */
function previousLaunchDay(): string | null | undefined {
  try {
    const text = execFileSync('git', ['show', 'HEAD~1:src/engine/launch-config.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseLaunchConfig(text) ?? null;
  } catch {
    try {
      // HEAD~1 exists but predates the config file: beta.
      execFileSync('git', ['rev-parse', '--verify', 'HEAD~1'], { stdio: 'ignore' });
      return null;
    } catch {
      return undefined;
    }
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

export default defineConfig(({ command }) => {
  // Vercel deploys main without waiting for CI, so the production build guards the
  // launch boundary itself (docs/LAUNCH.md): never switch the season on mid-day, and
  // never ship the launch preview switch.
  if (command === 'build' && process.env.VERCEL_ENV === 'production') {
    if (process.env.VITE_LAUNCH_PREVIEW) throw new Error('VITE_LAUNCH_PREVIEW is set in a production build; the launch preview is for non-production builds only.');
    const issue = LAUNCH_DAY === null ? null : activationIssue({ launchDay: LAUNCH_DAY, previous: previousLaunchDay(), today: puzzleDay(new Date()) });
    if (issue) throw new Error(issue);
  }
  return {
    plugins: [react(), scoresApi(), launchManifest()],
    build: { target: 'es2022', sourcemap: false },
  };
});
