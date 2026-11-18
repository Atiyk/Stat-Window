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
 *   it per day. "Delete my scores" sends it once more, then a new one is made.
 */
export type ScoreChoice = 'unset' | 'on' | 'off';
export type Privacy = {
  analytics: 'on' | 'off' | 'unset';
  scores: ScoreChoice;
  key: string | null;
  /** Days this browser's score was accepted (for deletion), newest last. */
  sent: string[];
};

export const PRIVACY_KEY = 'stat-window:privacy:v1';
const KEY_RE = /^[A-Za-z0-9_-]{22}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const empty = (): Privacy => ({ analytics: 'unset', scores: 'unset', key: null, sent: [] });
let memory: Privacy = empty();

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadPrivacy(s: Store | null = storage()): Privacy {
  if (!s) return memory;
  try {
    const raw = JSON.parse(s.getItem(PRIVACY_KEY) ?? 'null') as Partial<Privacy> | null;
    if (!raw || typeof raw !== 'object') return empty();
    return {
      analytics: raw.analytics === 'on' || raw.analytics === 'off' ? raw.analytics : 'unset',
      scores: raw.scores === 'on' || raw.scores === 'off' ? raw.scores : 'unset',
      key: typeof raw.key === 'string' && KEY_RE.test(raw.key) ? raw.key : null,
      sent: Array.isArray(raw.sent) ? raw.sent.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)).slice(-60) : [],
    };
  } catch {
    return empty();
  }
}

export function savePrivacy(patch: Partial<Privacy>, s: Store | null = storage()): Privacy {
  const next = { ...loadPrivacy(s), ...patch };
  next.sent = [...new Set(next.sent)].sort().slice(-60);
  memory = next;
  try {
    s?.setItem(PRIVACY_KEY, JSON.stringify(next));
  } catch {
    /* memory only */
  }
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

/** What to do with a finished official daily: send it, ask first, or leave it. */
export function scoreIntent(p: Privacy, signal: boolean): 'send' | 'ask' | 'skip' {
  if (p.scores === 'off') return 'skip';
  if (p.scores === 'on') return 'send';
  return signal ? 'ask' : 'send';
}
