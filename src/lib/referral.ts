import { puzzleDay } from '../engine/daily';

/** Fixed, coarse attribution. Never send a query value, host, path, ID or free text. */
const aliases = {
  x: 'x', twitter: 'x', threads: 'threads', reddit: 'reddit',
  playlin: 'playlin', alldle: 'alldle', listdle: 'directory',
  directory: 'directory', 'daily-games-to-play': 'directory', dlegames: 'directory',
  email: 'email', newsletter: 'email', creator: 'creator',
  groupchat: 'groupchat', discord: 'groupchat', whatsapp: 'groupchat',
  embed: 'embed', google: 'search', bing: 'search', search: 'search',
  tiktok: 'video', youtube: 'video', instagram: 'video',
  'how-to-play': 'guide', producthunt: 'launch', hackernews: 'launch',
} as const;
export type ReferralChannel = typeof aliases[keyof typeof aliases];

const referrers: Readonly<Record<string, ReferralChannel>> = {
  'x.com': 'x', 'twitter.com': 'x', 't.co': 'x',
  'threads.com': 'threads', 'threads.net': 'threads', 'l.threads.com': 'threads', 'l.threads.net': 'threads',
  'reddit.com': 'reddit', 'old.reddit.com': 'reddit', 'redd.it': 'reddit',
  'playlin.io': 'playlin', 'alldle.net': 'alldle', 'listdle.com': 'directory',
  'dailygamestoplay.com': 'directory', 'dlegames.gg': 'directory', 'dles.gg': 'directory',
  'google.com': 'search', 'bing.com': 'search', 'duckduckgo.com': 'search',
  'youtube.com': 'video', 'tiktok.com': 'video', 'instagram.com': 'video',
  'discord.com': 'groupchat', 'producthunt.com': 'launch', 'news.ycombinator.com': 'launch',
};
function own<T extends object>(o: T, key: string): T[keyof T] | undefined {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key as keyof T] : undefined;
}
export function referralChannel(search: string, referrer: string): ReferralChannel | null {
  const params = new URLSearchParams(search);
  const source = params.get('utm_source');
  if (source !== null) return own(aliases, source.trim().toLowerCase()) ?? null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return own(referrers, u.hostname.toLowerCase().replace(/^www\./, '')) ?? null;
  } catch { return null; }
}
/** A referral lasts at most one Eastern puzzle day, within its tab and cohort. */
export type ReferralScope = 'beta' | 's1' | 'qa';
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const scopes: readonly ReferralScope[] = ['beta', 's1', 'qa'];
const key = (scope: ReferralScope) => 'stat-window:referral:' + scope;
const channels = new Set<string>(Object.values(aliases));
let session: { scope: ReferralScope; day: string; channel: ReferralChannel } | null = null;

function sessionStore(): SessionStore | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage ?? null; }
  catch { return null; }
}

export function clearReferralSession(store = sessionStore()): void {
  session = null;
  for (const scope of scopes) {
    try { store?.removeItem(key(scope)); } catch { /* storage may be blocked */ }
  }
}

export function readReferralSession(scope: ReferralScope, day = puzzleDay(new Date()), store = sessionStore()): ReferralChannel | null {
  if (session && session.day !== day) clearReferralSession(store);
  return session?.scope === scope ? session.channel : null;
}

/** New recognized arrivals replace existing attribution. Reloads and history restores can
 * resume current-day attribution without replaying a tagged landing or renewing an old one.
 */
export function initReferralSession(
  scope: ReferralScope,
  search: string,
  referrer: string,
  origin: string,
  store = sessionStore(),
  day = puzzleDay(new Date()),
  restoring = false,
): { channel: ReferralChannel | null; landing: boolean } {
  const fresh = referralChannel(search, referrer);
  const explicit = new URLSearchParams(search).has('utm_source');
  let external = false;
  if (referrer) {
    try { external = new URL(referrer).origin !== origin; } catch { external = true; }
  }
  const landing = fresh !== null && !restoring;
  let channel = landing ? fresh : null;
  if (!landing && (fresh || (!explicit && !external))) {
    try {
      const saved = store?.getItem(key(scope));
      const prefix = `${day}:`;
      const candidate = saved?.startsWith(prefix) ? saved.slice(prefix.length) : undefined;
      if (candidate && channels.has(candidate)) channel = candidate as ReferralChannel;
    } catch { /* storage may be blocked */ }
  }
  session = channel ? { scope, day, channel } : null;
  for (const other of scopes) {
    try {
      if (other !== scope || !channel) store?.removeItem(key(other));
      else store?.setItem(key(scope), `${day}:${channel}`);
    } catch { /* no optional storage dependency */ }
  }
  return { channel, landing };
}

export function beginReferralSession(scope: ReferralScope): { channel: ReferralChannel | null; landing: boolean } {
  try {
    const navigation = window.performance?.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const restoring = navigation?.type === 'reload' || navigation?.type === 'back_forward';
    return initReferralSession(scope, window.location.search, document.referrer, window.location.origin,
      sessionStore(), puzzleDay(new Date()), restoring);
  } catch { session = null; return { channel: null, landing: false }; }
}
