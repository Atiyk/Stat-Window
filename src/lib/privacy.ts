/**
 * Player privacy choices and the browser-local score key. Policy: docs/PRIVACY.md.
 *
 * - analytics: 'on' | 'off'. Default on, except browsers sending Global Privacy
 *   Control or Do Not Track, which are treated as 'off' unless the player turns it on.
 * - scores: 'unset' | 'on' | 'off'. Whether today's total goes into the daily
 *   comparison. 'unset' sends only where the server says no consent is required
 *   (and never under GPC/DNT); otherwise the results screen asks first.
 * - key: 22 random URL-safe characters, made the first time a score is sent. It is
 *   never put in a URL or sent to analytics; the server only stores a salted hash of
 *   it per day. "Delete my scores" sends it for erasure, then clears it; a new code
 *   is made only after a future opt-in submission.
 */
export type ScoreChoice = 'unset' | 'on' | 'off';
export type Privacy = {
  analytics: 'on' | 'off' | 'unset';
  scores: ScoreChoice;
  key: string | null;
  /** Days a score may have been sent (recorded before sending, so deletion never misses one). */
  sent: string[];
  /** Days the server confirmed it holds this browser's score (later visits only read the tally). */
  done: string[];
  /** The server said this location needs an explicit yes (so "unset" means "not counted"). */
  asked: boolean;
  /** A DELETE was requested but is not confirmed: block all new submissions until retry succeeds. */
  deleting?: boolean;
};

export const PRIVACY_KEY = 'stat-window:privacy:v1';
const KEY_RE = /^[A-Za-z0-9_-]{22}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const empty = (): Privacy => ({ analytics: 'unset', scores: 'unset', key: null, sent: [], done: [], asked: false, deleting: false });
/** Submission records live 7 days on the server (plus a grace day), so older days need no tracking. */
const KEEP_DAYS = 9;
let memory: Privacy = empty();
/**
 * The storage whose last write failed (quota full, Safari private mode…). Until a write to it
 * succeeds again, `memory` is the truth for this session: otherwise an opt-out would read back as
 * "unset" and events or score sends would carry on while the dialog shows "off".
 */
let unwritable: Store | null = null;

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const days = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)))].sort().slice(-KEEP_DAYS) : [];

export function loadPrivacy(s: Store | null = storage()): Privacy {
  if (!s || s === unwritable) return memory;
  try {
    const raw = JSON.parse(s.getItem(PRIVACY_KEY) ?? 'null') as Partial<Privacy> | null;
    if (!raw || typeof raw !== 'object') return empty();
    return {
      analytics: raw.analytics === 'on' || raw.analytics === 'off' ? raw.analytics : 'unset',
      scores: raw.scores === 'on' || raw.scores === 'off' ? raw.scores : 'unset',
      key: typeof raw.key === 'string' && KEY_RE.test(raw.key) ? raw.key : null,
      sent: days(raw.sent),
      done: days(raw.done),
      asked: raw.asked === true,
      deleting: raw.deleting === true,
    };
  } catch {
    return empty();
  }
}

export function savePrivacy(patch: Partial<Privacy>, s: Store | null = storage()): Privacy {
  const next = { ...loadPrivacy(s), ...patch };
  next.sent = days(next.sent);
  next.done = days(next.done);
  memory = next;
  try {
    s?.setItem(PRIVACY_KEY, JSON.stringify(next));
    if (s === unwritable) unwritable = null;
  } catch {
    // Memory only, for the rest of this session.
    unwritable = s;
  }
  // A storage event does not fire in the tab which made the change.
  // Let an already-open results screen stop displaying an obsolete percentile
  // immediately when this tab withdraws consent or begins erasure.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function')
    window.dispatchEvent(new Event('stat-window:privacy-choice'));
  return next;
}

export function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

/** The key, made on first use. */
export function scoreKey(s: Store | null = storage()): string {
  const p = loadPrivacy(s);
  if (p.key) return p.key;
  return savePrivacy({ key: newKey() }, s).key!;
}

export function browserSignal(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === '1';
}

/** Whether anonymous gameplay counting is on for this browser. */
export function analyticsAllowed(p: Privacy, signal: boolean): boolean {
  return p.analytics === 'on' || (p.analytics === 'unset' && !signal);
}

/** Whether the player is (or would be) counted, as the Privacy dialog shows it. */
export function scoresShownOn(p: Privacy, signal: boolean): boolean {
  if (p.deleting) return false;
  return p.scores === 'on' || (p.scores === 'unset' && !signal && !p.asked);
}

/** What to do with a finished official daily: send it, ask first, or leave it. */
export function scoreIntent(p: Privacy, signal: boolean): 'send' | 'ask' | 'skip' {
  if (p.deleting) return 'skip';
  if (p.scores === 'off') return 'skip';
  if (p.scores === 'on') return 'send';
  // Asked before in this location, or a browser privacy signal: ask without a network round trip.
  return signal || p.asked ? 'ask' : 'send';
}
