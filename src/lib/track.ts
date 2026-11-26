/**
 * Measurement. Spec and event dictionary: docs/MEASUREMENT.md.
 *
 * Free by construction: events go to Vercel Web Analytics, which the project's
 * Hobby plan includes. Hobby has no custom events, so each event is sent as a
 * *virtual page view* on a path under `/e/…` (for example `/e/lock/r3/hit`). Counts
 * per path then show up in the Vercel dashboard's Pages list. At the Hobby limit
 * Vercel pauses collection; it never bills a Hobby team.
 *
 * Off unless on a production host (VITE_ANALYTICS_HOSTS, default stat-window.vercel.app) or the build
 * sets VITE_ANALYTICS=vercel (so local runs, CI and preview builds send nothing). Also off when the browser sends Global Privacy Control or
 * Do Not Track. No cookies, no identifiers, no answers, no free text: every path
 * segment comes from the fixed vocabulary below.
 */
import { inject, pageview } from '@vercel/analytics';
import { analyticsAllowed, loadPrivacy, type Privacy } from './privacy';

export type PlayMode = 'daily' | 'practice' | 'challenge';
export type ChallengeOpen = 'today' | 'past' | 'future' | 'invalid';
export type ShareMethod = 'native' | 'native-image' | 'clipboard' | 'image-saved' | 'failed' | 'cancelled';
export type ScoreOutcome = 'stored' | 'gathering' | 'ready' | 'consent' | 'ineligible' | 'disabled' | 'unavailable';

export type TrackEvent =
  /** First time this browser opens the game. */
  | { name: 'visit_new' }
  /** First open on a new UTC day by a browser seen before. gap = days since its previous visit; age = days since its first. */
  | { name: 'visit_return'; gap: number; age: number }
  | { name: 'run_start'; mode: PlayMode }
  /** First bracket move of a run (round 1 only, so it measures first understanding). */
  | { name: 'first_touch'; mode: PlayMode }
  | { name: 'round_lock'; mode: PlayMode; round: number; hit: boolean }
  /** Player pressed Next after round N's reveal. */
  | { name: 'round_next'; mode: PlayMode; round: number }
  /** Page hidden or closed with a run in progress (best effort: browsers may drop it). */
  | { name: 'run_exit'; mode: PlayMode; round: number }
  | { name: 'run_complete'; mode: PlayMode; total: number }
  /** A daily run finished; days = the daily streak it leaves (counted from the daily record). */
  | { name: 'streak'; days: number }
  | { name: 'share'; mode: PlayMode; method: ShareMethod }
  | { name: 'challenge_open'; kind: ChallengeOpen; withScore: boolean; withRounds?: boolean }
  /** What the daily comparison showed on the results screen (exposure, not a verified ranking). */
  | { name: 'percentile'; outcome: ScoreOutcome }
  /** A privacy choice made in the app. */
  | { name: 'privacy'; choice: 'scores-on' | 'scores-off' | 'deleted' }
  /** A calendar reminder link was tapped on the results screen (src/engine/remind.ts). */
  | { name: 'remind'; method: 'ics' | 'google' }
  /** The page was opened from the reminder event's link (?from=calendar), once per browser and puzzle day. */
  | { name: 'remind_open' }
  /** Survival (docs/SURVIVAL.md). `again` = the player pressed "Run it again". */
  | { name: 'survival_start'; source: 'cta' | 'link' | 'again' }
  | { name: 'survival_reach'; round: 5 | 10 | 15 }
  /** round = the round that ended the run (1-20); reason = outside, or inside but under the minimum. */
  | { name: 'survival_end'; round: number; reason: 'miss' | 'short' }
  | { name: 'survival_win' }
  | { name: 'survival_share'; method: ShareMethod }
  /** Home and results entry points (V5.1). Fixed vocabulary only: no scores, days or answers. */
  | { name: 'scouting_open'; source: 'home' | 'results' }
  | { name: 'weekly_open'; source: 'home' | 'results' | 'scouting' }
  | { name: 'weekly_share'; method: ShareMethod }
  /** Practice discovery on the home screen: the list was opened, or a past game was started from it. */
  | { name: 'practice_discover'; step: 'expand' | 'start' }
  /** The one experiment: arm is per browser, step is what happened. */
  | { name: 'experiment'; arm: 'cta' | 'control'; step: 'exposed' | 'first-exposure' | 'click' | 'daily-start' | 'next-day-start' | 'daily-share' };

/** Rounds 1-4, 5-8 … so the end of a run lands in one of five rows. */
export function survivalBand(round: number): string {
  const lo = Math.floor((Math.min(20, Math.max(1, round)) - 1) / 4) * 4 + 1;
  return `r${lo}-${lo + 3}`;
}

/** Coarse buckets keep the dashboard readable and avoid one path per exact value. */
export function gapBucket(days: number): string {
  if (days <= 1) return '1';
  if (days <= 6) return '2-6';
  return '7plus';
}
export function totalBand(total: number): string {
  const lo = Math.min(4, Math.floor(total / 100)) * 100;
  return lo === 400 ? '400-500' : `${lo}-${lo + 99}`;
}

/**
 * Cohort prefix: none for the public beta (so its paths stay comparable with every
 * earlier release), `/s1` once a formal launch season is live, `/qa` for QA browsers.
 */
let cohort = '';
export function setCohort(c: 'beta' | 's1' | 'qa'): void {
  cohort = c === 'beta' ? '' : `/${c}`;
}

/** The fixed path each event is counted under. */
export function eventPath(e: TrackEvent): string {
  const p = basePath(e);
  return cohort ? p.replace(/^\/e\//, `/e${cohort}/`) : p;
}

function basePath(e: TrackEvent): string {
  switch (e.name) {
    case 'visit_new':
      return '/e/visit/new';
    case 'visit_return': {
      // age is reported only on the two cohort days the plan asks about.
      const cohort = e.age === 1 ? '/day1' : e.age === 7 ? '/day7' : '';
      return `/e/visit/return/gap-${gapBucket(e.gap)}${cohort}`;
    }
    case 'run_start':
      return `/e/start/${e.mode}`;
    case 'first_touch':
      return `/e/first-touch/${e.mode}`;
    case 'round_lock':
      return `/e/lock/${e.mode}/r${e.round}/${e.hit ? 'hit' : 'miss'}`;
    case 'round_next':
      return `/e/next/${e.mode}/r${e.round}`;
    case 'run_exit':
      return `/e/exit/${e.mode}/r${e.round}`;
    case 'run_complete':
      return `/e/complete/${e.mode}/${totalBand(e.total)}`;
    case 'streak':
      return `/e/streak/daily/${gapBucket(e.days)}`;
    case 'share':
      return `/e/share/${e.mode}/${e.method}`;
    case 'challenge_open':
      return `/e/challenge-open/${e.kind}${e.withScore ? '/with-score' : ''}${e.withScore && e.withRounds ? '/with-rounds' : ''}`;
    case 'percentile':
      return `/e/percentile/${e.outcome}`;
    case 'privacy':
      return `/e/privacy/${e.choice}`;
    case 'remind':
      return `/e/remind/${e.method}`;
    case 'remind_open':
      return '/e/remind/open';
    case 'survival_start':
      return `/e/survival/start/${e.source}`;
    case 'survival_reach':
      return `/e/survival/reach/r${e.round}`;
    case 'survival_end':
      return `/e/survival/end/${survivalBand(e.round)}/${e.reason}`;
    case 'survival_win':
      return '/e/survival/win';
    case 'survival_share':
      return `/e/survival/share/${e.method}`;
    case 'scouting_open':
      return `/e/scouting/open/${e.source}`;
    case 'weekly_open':
      return `/e/weekly/open/${e.source}`;
    case 'weekly_share':
      return `/e/weekly/share/${e.method}`;
    case 'practice_discover':
      return `/e/practice/${e.step}/home`;
    case 'experiment':
      return `/e/x/survival-cta/${e.arm}/${e.step}`;
  }
}

type Sink = (e: TrackEvent) => void;

const devSink: Sink = (e) => {
  if (import.meta.env.DEV) console.debug('[track]', eventPath(e), e);
};
let sink: Sink = devSink;

export function setTrackSink(next: Sink): void {
  sink = next;
}

export function track(e: TrackEvent): void {
  try {
    sink(e);
  } catch {
    /* measurement must never break the game */
  }
}

/**
 * Sends `e` only the first time `key` is seen in this browser, so a refresh, a
 * remount or a second tab does not count the same start or first touch twice.
 * Keys are kept for 14 days. Without storage it falls back to once per page load.
 */
const ONCE_KEY = 'stat-window:sent';
const sentThisLoad = new Set<string>();
export function trackOnce(key: string, day: string, e: TrackEvent, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): boolean {
  if (sentThisLoad.has(key)) return false;
  sentThisLoad.add(key);
  if (storage) {
    try {
      const raw = JSON.parse(storage.getItem(ONCE_KEY) ?? '{}') as Record<string, string>;
      if (typeof raw[key] === 'string') return false;
      const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
      const kept = Object.fromEntries(Object.entries(raw).filter(([, d]) => typeof d === 'string' && d >= cutoff));
      kept[key] = day;
      storage.setItem(ONCE_KEY, JSON.stringify(kept));
    } catch {
      /* unreadable or full storage: once per page load is the best we can do */
    }
  }
  track(e);
  return true;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function privacySignal(nav: Navigator): boolean {
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === '1';
}

/** The default production hostname. Override the list with VITE_ANALYTICS_HOSTS (docs/MEASUREMENT.md). */
export const PRODUCTION_HOST = 'stat-window.vercel.app';
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The hostnames analytics runs on: VITE_ANALYTICS_HOSTS, comma-separated, exact names only (no scheme,
 * port, path or wildcard; anything else is ignored). Unset or empty means stat-window.vercel.app, so
 * moving to a real domain is a build variable, not a code change.
 */
export function analyticsHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => HOSTNAME.test(h));
  return hosts.length ? [...new Set(hosts)] : [PRODUCTION_HOST];
}

/**
 * On when the build sets VITE_ANALYTICS=vercel (any host, used by the analytics e2e build), or on one of
 * the production hostnames unless the build sets VITE_ANALYTICS=off (the emergency switch). Previews,
 * local runs and CI are on other hosts, so they send nothing.
 */
export function analyticsOn(flag: string | undefined, host: string | undefined, hosts: readonly string[] = [PRODUCTION_HOST]): boolean {
  const f = (flag ?? '').trim().toLowerCase();
  if (f === 'off') return false;
  if (f === 'vercel') return true;
  return host !== undefined && hosts.includes(host.toLowerCase());
}

export const analyticsEnabled = analyticsOn(
  import.meta.env.VITE_ANALYTICS as string | undefined,
  typeof location === 'undefined' ? undefined : location.hostname,
  analyticsHosts(import.meta.env.VITE_ANALYTICS_HOSTS as string | undefined),
);

type Vercel = { inject: typeof inject; pageview: typeof pageview };

/** What `startAnalytics` was given when the build and host allow analytics, so the Privacy dialog can start it later. */
let pending: { nav: Navigator; vercel: Vercel } | null = null;
let active = false;

/**
 * Starts Vercel Web Analytics and routes events to it. Safe to call once at startup.
 *
 * Auto-tracking is off and the real page view is sent by hand: the Vercel script
 * keeps the last `path` given to pageview() and reuses it for later automatic page
 * views, which would file a real visit under a stale `/e/…` path.
 */
export function startAnalytics(
  opts: { enabled?: boolean; nav?: Navigator; vercel?: Vercel; privacy?: Privacy } = {},
): boolean {
  const enabled = opts.enabled ?? analyticsEnabled;
  pending = null;
  active = false;
  if (!enabled || typeof window === 'undefined') return false;
  pending = { nav: opts.nav ?? navigator, vercel: opts.vercel ?? { inject, pageview } };
  // GPC/DNT and the in-app switch both stop analytics; an explicit "on" in the app overrides GPC/DNT.
  if (!analyticsAllowed(opts.privacy ?? loadPrivacy(), privacySignal(pending.nav))) return false;
  activate(pending);
  return true;
}

/**
 * Starts analytics now if the build and host allow it and the player's choice allows it, for when
 * it was off at startup and the player switches it on in the Privacy dialog. Never starts twice.
 */
export function resumeAnalytics(): boolean {
  if (active) return true;
  if (!pending || !analyticsAllowed(loadPrivacy(), privacySignal(pending.nav))) return false;
  activate(pending);
  return true;
}

function activate({ nav, vercel: v }: { nav: Navigator; vercel: Vercel }): void {
  active = true;
  v.inject({
    mode: 'production',
    disableAutoTrack: true,
    // Page views keep only the path: challenge links carry a day and a score we don't need to collect.
    beforeSend: (event) => {
      try {
        const u = new URL(event.url);
        return { ...event, url: `${u.origin}${u.pathname}` };
      } catch {
        return null; // an unreadable URL is dropped rather than sent with its query string
      }
    },
  });
  v.pageview({ route: '/', path: '/' });
  setTrackSink((e) => {
    if (!analyticsAllowed(loadPrivacy(), privacySignal(nav))) return; // switched off this session
    const path = eventPath(e);
    v.pageview({ route: path, path });
  });
}
