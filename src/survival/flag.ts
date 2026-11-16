/**
 * Survival feature flag, fixed at build time (VITE_SURVIVAL):
 *   off      (default, and anything unrecognised) Survival is not in the build at all.
 *   preview  reachable only at /?survival, with a "Preview" banner; `&asof=YYYY-MM-DD`
 *            simulates a later date so the full pool can be tested. For Vercel Preview
 *            deployments only, never Production: asof can show questions from days
 *            that have not been played yet.
 *   on       public: /?survival works and finished Daily Five results offer it,
 *            but only while the eligible pool passes the beta gate.
 */
export type SurvivalFlag = 'off' | 'preview' | 'on';

export function parseFlag(v: string | undefined): SurvivalFlag {
  return v === 'preview' || v === 'on' ? v : 'off';
}

// Written as literal comparisons so the bundler drops all Survival code from an "off" build.
export const SURVIVAL_FLAG: SurvivalFlag =
  import.meta.env.VITE_SURVIVAL === 'on' ? 'on' : import.meta.env.VITE_SURVIVAL === 'preview' ? 'preview' : 'off';

/** The CTA experiment runs only when VITE_SURVIVAL_CTA_TEST=1 as well (see docs/SURVIVAL.md). */
export const CTA_TEST = import.meta.env.VITE_SURVIVAL_CTA_TEST === '1';

/** `?asof=` is honoured only by preview builds. */
export function previewAsOf(search: string, flag: SurvivalFlag = SURVIVAL_FLAG): string | null {
  if (flag !== 'preview') return null;
  const v = new URLSearchParams(search).get('asof');
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return null;
  return v;
}

export function wantsSurvival(search: string, flag: SurvivalFlag = SURVIVAL_FLAG): boolean {
  return flag !== 'off' && new URLSearchParams(search).has('survival');
}
