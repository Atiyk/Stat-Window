/**
 * Measurement. Spec and event dictionary: docs/MEASUREMENT.md.
 *
 * Free by construction: events go to Vercel Web Analytics, which the project's
 * Hobby plan includes. Hobby has no custom events, so each event is sent as a
 * *virtual page view* on a path under `/e/…` (for example `/e/lock/r3/hit`). Counts
 * per path then show up in the Vercel dashboard's Pages list. At the Hobby limit
 * Vercel pauses collection; it never bills a Hobby team.
 *
 * On the exact production hosts below, or when a local test build sets VITE_ANALYTICS=vercel.
 * Also off when the browser sends Global Privacy Control or
 * Do Not Track. No cookies, no identifiers, no answers, no free text: every path
 * segment comes from the fixed vocabulary below.
 */
import { inject, pageview } from '@vercel/analytics';
import { analyticsAllowed, loadPrivacy, type Privacy } from './privacy';
import { PRODUCTION_HOSTS } from './site';
import { beginReferralSession, clearReferralSession, readReferralSession, type ReferralChannel } from './referral';

export type PlayMode = 'daily' | 'practice' | 'challenge';
export type AnalyticsCohort = 'beta' | 's1' | 'qa';
export type ChallengeOpen = 'today' | 'past' | 'future' | 'invalid';
export type ShareMethod = 'native' | 'native-image' | 'clipboard' | 'image-saved' | 'failed' | 'cancelled';

export type TrackEvent = (
  /** First time this browser opens the game. */
  | { name: 'visit_new' }
  | { name: 'referral'; channel: ReferralChannel; step: 'landing' | 'start' | 'complete' }
  /** First open on a new Eastern day by a browser seen before. gap = days since its previous visit; age = days since its first. */
  | { name: 'visit_return'; gap: number; age: number }
  | { name: 'run_start'; mode: PlayMode; diagnostics?: { key: string; day: string } }
  | { name: 'sample_start' }
  /** First bracket move and locks from the same sampled daily start. The key stays on this browser. */
  | { name: 'first_touch'; sampleKey: string }
  | { name: 'round_lock'; sampleKey: string; round: number; hit: boolean }
  | { name: 'run_complete'; mode: PlayMode; total: number }
  /** A daily run finished; days = the daily streak it leaves (counted from the daily record). */
  | { name: 'streak'; days: number }
  | { name: 'share'; mode: PlayMode; method: ShareMethod }
  | { name: 'challenge_open'; kind: ChallengeOpen; withScore: boolean; withRounds?: boolean }
  /** Fixed error categories. Error text, URLs, stacks and payloads are never sent. */
  | { name: 'failure'; source: 'game' | 'comparison' }
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
  /** The first-play tutorial was shown, skipped before its lock, or played through to its Play button. */
  | { name: 'tutorial'; step: 'start' | 'skip' | 'complete' }
  /** The one experiment: arm is per browser, step is what happened. */
  | { name: 'experiment'; arm: 'cta' | 'control'; step: 'exposed' | 'first-exposure' | 'click' | 'daily-start' | 'next-day-start' | 'daily-share' }
) & { cohort?: AnalyticsCohort };

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
let cohort: AnalyticsCohort = 'beta';
export function setCohort(c: AnalyticsCohort): void {
  cohort = c;
}

/** The fixed path each event is counted under. */
export function eventPath(e: TrackEvent): string {
  const p = basePath(e);
  const scope = cohort === 'qa' ? 'qa' : e.cohort ?? cohort;
  return scope === 'beta' ? p : p.replace(/^\/e\//, `/e/${scope}/`);
}

function basePath(e: TrackEvent): string {
  switch (e.name) {
    case 'referral':
      return `/e/referral/${e.channel}/${e.step}`;
    case 'visit_new':
      return '/e/visit/new';
    case 'visit_return': {
      // age is reported only on the two cohort days the plan asks about.
      const cohort = e.age === 1 ? '/day1' : e.age === 7 ? '/day7' : '';
      return `/e/visit/return/gap-${gapBucket(e.gap)}${cohort}`;
    }
    case 'run_start':
      return `/e/start/${e.mode}`;
    case 'sample_start':
      return '/e/sample/start/daily';
    case 'first_touch':
      return '/e/sample/first-touch/daily';
    case 'round_lock':
      return `/e/sample/lock/daily/r${e.round}/${e.hit ? 'hit' : 'miss'}`;
    case 'run_complete':
      return `/e/complete/${e.mode}/${totalBand(e.total)}`;
    case 'streak':
      return `/e/streak/daily/${gapBucket(e.days)}`;
    case 'share':
      return `/e/share/${e.mode}/${e.method}`;
    case 'challenge_open':
      return `/e/challenge-open/${e.kind}${e.withScore ? '/with-score' : ''}${e.withScore && e.withRounds ? '/with-rounds' : ''}`;
    case 'failure':
      return `/e/failure/${e.source}`;
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
    case 'tutorial':
      return `/e/tutorial/${e.step}`;
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
type EventStorage = Pick<Storage, 'getItem' | 'setItem'>;

function readLedger(storage: EventStorage): Record<string, unknown> {
  const raw: unknown = JSON.parse(storage.getItem(ONCE_KEY) ?? '{}');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function rememberEvent(storage: EventStorage, raw: Record<string, unknown>, key: string, day: string): void {
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const kept = Object.fromEntries(Object.entries(raw).filter(([, d]) => typeof d === 'string' && d >= cutoff));
  kept[key] = day;
  storage.setItem(ONCE_KEY, JSON.stringify(kept));
}

export function trackOnce(key: string, day: string, e: TrackEvent, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): boolean {
  if (sentThisLoad.has(key)) return false;
  sentThisLoad.add(key);
  if (storage) {
    try {
      const raw = readLedger(storage);
      if (typeof raw[key] === 'string') return false;
      rememberEvent(storage, raw, key, day);
    } catch {
      /* unreadable or full storage: once per page load is the best we can do */
    }
  }
  track(e);
  return true;
}

/** One draw per daily start, recorded in the existing local dedup ledger so the same run survives reloads. */
function sampleRun(key: string, day: string): boolean {
  const storage = safeStorage();
  if (!storage || Math.random() >= 0.1) return false;
  try {
    const raw = readLedger(storage);
    const marker = `sample:${key}`;
    if (typeof raw[marker] === 'string') return false;
    rememberEvent(storage, raw, marker, day);
    return true;
  } catch {
    return false;
  }
}

function sampledRun(key: string): boolean {
  const storage = safeStorage();
  try {
    return storage !== null && typeof readLedger(storage)[`sample:${key}`] === 'string';
  } catch {
    return false;
  }
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

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The hostnames analytics runs on: VITE_ANALYTICS_HOSTS, comma-separated, exact names only (no scheme,
 * port, path or wildcard; anything else is ignored). Unset or empty uses the public production hosts.
 */
export function analyticsHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => HOSTNAME.test(h));
  return hosts.length ? [...new Set(hosts)] : [...PRODUCTION_HOSTS];
}

/**
 * Only production can send on Vercel, and only from the configured public hostnames.
 * Local analytics e2e builds can use VITE_ANALYTICS=vercel. The off switch applies everywhere.
 */
export function analyticsOn(
  flag: string | undefined,
  host: string | undefined,
  hosts: readonly string[] = PRODUCTION_HOSTS,
  deployment?: string,
): boolean {
  const f = (flag ?? '').trim().toLowerCase();
  if (f === 'off' || (deployment && deployment !== 'production')) return false;
  if (f === 'vercel' && !deployment) return true;
  return host !== undefined && hosts.includes(host.toLowerCase());
}

export const analyticsEnabled = analyticsOn(
  import.meta.env.VITE_ANALYTICS as string | undefined,
  typeof location === 'undefined' ? undefined : location.hostname,
  analyticsHosts(import.meta.env.VITE_ANALYTICS_HOSTS as string | undefined),
  import.meta.env.VITE_VERCEL_ENV as string | undefined,
);

type Vercel = { inject: typeof inject; pageview: typeof pageview };

/** What `startAnalytics` was given when the build and host allow analytics, so the Privacy dialog can start it later. */
let pending: { nav: Navigator; vercel: Vercel } | null = null;
let active = false;
let removePrivacyListener: (() => void) | undefined;

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
  removePrivacyListener?.();
  removePrivacyListener = undefined;
  pending = null;
  active = false;
  setTrackSink(devSink);
  if (!enabled || typeof window === 'undefined') { clearReferralSession(); return false; }
  pending = { nav: opts.nav ?? navigator, vercel: opts.vercel ?? { inject, pageview } };
  // GPC/DNT and the in-app switch both stop analytics; an explicit "on" in the app overrides GPC/DNT.
  if (!analyticsAllowed(opts.privacy ?? loadPrivacy(), privacySignal(pending.nav))) { clearReferralSession(); return false; }
  return activate(pending);
}

/**
 * Starts analytics now if the build and host allow it and the player's choice allows it, for when
 * it was off at startup and the player switches it on in the Privacy dialog. Never starts twice.
 */
export function resumeAnalytics(): boolean {
  if (active) return true;
  if (!pending || !analyticsAllowed(loadPrivacy(), privacySignal(pending.nav))) return false;
  return activate(pending);
}

function activate({ nav, vercel: v }: { nav: Navigator; vercel: Vercel }): boolean {
  try {
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
  } catch {
    return false; // an optional provider must never prevent the app from mounting
  }
  const send = (e: TrackEvent) => {
    const path = eventPath(e);
    v.pageview({ route: path, path });
  };
  const { channel, landing } = beginReferralSession(cohort);
  if (channel && landing) {
    try { send({ name: 'referral', channel, step: 'landing' }); }
    catch { /* optional measurement must not block the game */ }
  }
  // Other tabs can also withdraw consent. No listener is needed in non-browser unit fixtures.
  if (typeof window.addEventListener === 'function') {
    const onPrivacy = () => { if (!analyticsAllowed(loadPrivacy(), privacySignal(nav))) clearReferralSession(); };
    window.addEventListener('storage', onPrivacy);
    window.addEventListener('stat-window:privacy-choice', onPrivacy);
    removePrivacyListener = () => {
      window.removeEventListener('storage', onPrivacy);
      window.removeEventListener('stat-window:privacy-choice', onPrivacy);
    };
  }
  setTrackSink((e) => {
    if (!analyticsAllowed(loadPrivacy(), privacySignal(nav))) { clearReferralSession(); return; }
    const scope = cohort === 'qa' ? 'qa' : e.cohort ?? cohort;
    const referral = readReferralSession(scope);
    if ((e.name === 'first_touch' || e.name === 'round_lock') && !sampledRun(e.sampleKey)) return;
    send(e);
    if (referral && (e.name === 'run_start' || e.name === 'run_complete') && e.mode !== 'practice') {
      send({ name: 'referral', channel: referral, step: e.name === 'run_start' ? 'start' : 'complete', cohort: e.cohort ?? cohort });
    }
    if (e.name === 'run_start' && e.mode === 'daily' && e.diagnostics && sampleRun(e.diagnostics.key, e.diagnostics.day)) {
      send({ name: 'sample_start', cohort: e.cohort ?? cohort });
    }
  });
  active = true;
  return true;
}
