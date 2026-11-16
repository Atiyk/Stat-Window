/**
 * Measurement. Spec and event dictionary: docs/MEASUREMENT.md.
 *
 * Free by construction: events go to Vercel Web Analytics, which the project's
 * Hobby plan includes. Hobby has no custom events, so each event is sent as a
 * *virtual page view* on a path under `/e/…` (for example `/e/lock/r3/hit`). Counts
 * per path then show up in the Vercel dashboard's Pages list. At the Hobby limit
 * Vercel pauses collection; it never bills a Hobby team.
 *
 * Off unless the build sets VITE_ANALYTICS=vercel (so local runs, CI and preview
 * builds send nothing). Also off when the browser sends Global Privacy Control or
 * Do Not Track. No cookies, no identifiers, no answers, no free text: every path
 * segment comes from the fixed vocabulary below.
 */
import { inject, pageview } from '@vercel/analytics';

export type PlayMode = 'daily' | 'practice' | 'challenge';
export type ChallengeOpen = 'today' | 'past' | 'future' | 'invalid';
export type ShareMethod = 'native' | 'clipboard' | 'failed' | 'cancelled';

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
  | { name: 'share'; mode: PlayMode; method: ShareMethod }
  | { name: 'challenge_open'; kind: ChallengeOpen; withScore: boolean };

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

/** The fixed path each event is counted under. */
export function eventPath(e: TrackEvent): string {
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
    case 'share':
      return `/e/share/${e.mode}/${e.method}`;
    case 'challenge_open':
      return `/e/challenge-open/${e.kind}${e.withScore ? '/with-score' : ''}`;
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

export function privacySignal(nav: Navigator): boolean {
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === '1';
}

export const analyticsEnabled = import.meta.env.VITE_ANALYTICS === 'vercel';

/** Starts Vercel Web Analytics and routes events to it. Safe to call once at startup. */
export function startAnalytics(): boolean {
  if (!analyticsEnabled || typeof window === 'undefined' || privacySignal(navigator)) return false;
  inject({
    mode: 'production',
    // Page views keep only the path: challenge links carry a day and a score we don't need to collect.
    beforeSend: (event) => {
      const u = new URL(event.url);
      return { ...event, url: `${u.origin}${u.pathname}` };
    },
  });
  setTrackSink((e) => {
    const path = eventPath(e);
    pageview({ route: path, path });
  });
  return true;
}
