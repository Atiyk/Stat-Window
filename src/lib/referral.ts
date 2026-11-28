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
