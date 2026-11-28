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
  const source = params.get('utm_source')?.trim().toLowerCase() ?? '';
  const tagged = own(aliases, source);
  if (tagged) return tagged;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return own(referrers, u.hostname.toLowerCase().replace(/^www\./, '')) ?? null;
  } catch { return null; }
}
export function currentReferral(): ReferralChannel | null {
  try {
    return typeof window === 'undefined' || typeof document === 'undefined'
      ? null : referralChannel(window.location.search, document.referrer);
  } catch { return null; }
}

/** Only the fixed channel is stored in a tab session; the cohort is part of the fixed key. */
export type ReferralScope = 'beta' | 's1' | 'qa';
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const scopes: readonly ReferralScope[] = ['beta', 's1', 'qa'];
const key = (scope: ReferralScope) => 'stat-window:referral:' + scope;
const channels = new Set<string>(Object.values(aliases));
let session: { scope: ReferralScope; channel: ReferralChannel } | null = null;

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

export function readReferralSession(scope: ReferralScope): ReferralChannel | null {
  return session?.scope === scope ? session.channel : null;
}

/** Called only after analytics is allowed. New recognized arrivals override earlier channels.
 * A new unknown tag or external site clears prior attribution; untagged reloads/internal navigation
 * may continue it, with no extra landing event. A new cohort never inherits another cohort's value.
 */
export function initReferralSession(scope: ReferralScope, search: string, referrer: string, origin: string, store = sessionStore()): { channel: ReferralChannel | null; landing: boolean } {
  const fresh = referralChannel(search, referrer);
  const explicit = new URLSearchParams(search).has('utm_source');
  let external = false;
  if (referrer) {
    try { external = new URL(referrer).origin !== origin; } catch { external = true; }
  }
  let channel: ReferralChannel | null = fresh;
  if (!fresh && !explicit && !external) {
    try {
      const saved = store?.getItem(key(scope));
      if (saved && channels.has(saved)) channel = saved as ReferralChannel;
    } catch { /* page-load attribution still works */ }
  }
  session = channel ? { scope, channel } : null;
  // Do not leave beta or QA attribution available for a later return to another cohort.
  for (const other of scopes) {
    try {
      if (other !== scope || !channel) store?.removeItem(key(other));
      else store?.setItem(key(scope), channel);
    } catch { /* no optional storage dependency */ }
  }
  return { channel, landing: fresh !== null };
}

export function beginReferralSession(scope: ReferralScope): { channel: ReferralChannel | null; landing: boolean } {
  try { return initReferralSession(scope, window.location.search, document.referrer, window.location.origin); }
  catch { session = null; return { channel: null, landing: false }; }
}
