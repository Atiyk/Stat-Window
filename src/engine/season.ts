/**
 * Public numbering and seasons. Runbook: docs/LAUNCH.md.
 *
 * Three ideas are kept apart:
 * - the canonical puzzle day: the UTC date a slate lives at (content/days/<day>.json).
 *   It never changes, so saved runs, published locks and ?day= links stay valid;
 * - the season: `beta` (everything today) or the formal launch season `s1`;
 * - the public number shown to players. In beta it is the day count from EPOCH_DAY
 *   (unchanged from before this module). Once a launch day is configured, that day is
 *   "No. 1", the next "No. 2", and every earlier day becomes "Beta No. N".
 *
 * The launch day is fixed at build time (VITE_LAUNCH_DAY). Unset means beta: the live
 * game behaves exactly as before. Non-production builds can preview a launch with
 * `?launch-preview=YYYY-MM-DD` when VITE_LAUNCH_PREVIEW=1 (never in production).
 */
import { EPOCH_DAY } from './daily.ts';

export type SeasonId = 'beta' | 's1';

export type SeasonConfig = {
  /** First official day (UTC), or null while the game is in public beta. */
  readonly launchDay: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function dayIndex(day: string, from: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** A config is only accepted with a real date on or after the beta epoch. */
export function parseLaunchDay(raw: unknown): string | null {
  return isIsoDay(raw) && raw > EPOCH_DAY ? raw : null;
}

export const BETA: SeasonConfig = { launchDay: null };

/** The season a canonical day belongs to under `config`. */
export function seasonOf(day: string, config: SeasonConfig): SeasonId {
  return config.launchDay !== null && day >= config.launchDay ? 's1' : 'beta';
}

/** The season whose official daily runs on `today` (the one new scores count toward). */
export const currentSeason = (today: string, config: SeasonConfig): SeasonId => seasonOf(today, config);

export type PublicNumber = { readonly season: SeasonId; readonly number: number; readonly label: string };

/**
 * "No. 7" or "Beta No. 12". In beta mode every day keeps the number it has always
 * had. After launch, beta days are labelled as such so they can't be mistaken for
 * official puzzles.
 */
export function publicNumber(day: string, config: SeasonConfig): PublicNumber {
  const season = seasonOf(day, config);
  if (season === 's1') {
    const number = dayIndex(day, config.launchDay!) + 1;
    return { season, number, label: `No. ${number}` };
  }
  const number = dayIndex(day, EPOCH_DAY) + 1;
  return { season, number, label: config.launchDay === null ? `No. ${number}` : `Beta No. ${number}` };
}

/** Publicly playable days. A formal launch retires the beta catalog from discovery and links,
 * without deleting saved runs or changing their historical season classification. */
export function playableDays(days: readonly string[], today: string, config: SeasonConfig): string[] {
  return config.launchDay === null || today < config.launchDay ? [...days] : days.filter((day) => day >= config.launchDay!);
}

/** A beta link is retired only after the formal launch has begun. */
export function isRetiredDay(day: string, today: string, config: SeasonConfig): boolean {
  return config.launchDay !== null && today >= config.launchDay && isIsoDay(day) && day < config.launchDay;
}

/** Runs that count toward the season's stats and streaks (beta history never inflates a launch). */
export function inSeason<T>(runs: Readonly<Record<string, T>>, season: SeasonId, config: SeasonConfig): Record<string, T> {
  return Object.fromEntries(Object.entries(runs).filter(([day]) => seasonOf(day, config) === season));
}

/** The build's configuration, with an optional preview override outside production. */
export function seasonConfigFrom(env: { launchDay?: string | undefined; preview?: string | undefined }, search = ''): SeasonConfig {
  if (env.preview === '1') {
    try {
      const p = parseLaunchDay(new URLSearchParams(search).get('launch-preview'));
      if (p) return { launchDay: p };
    } catch {
      /* ignore */
    }
  }
  return { launchDay: parseLaunchDay(env.launchDay) };
}
