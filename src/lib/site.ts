export const CANONICAL_HOST = 'www.statwindow.app';
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
export const CANONICAL_URL = `${CANONICAL_ORIGIN}/`;

export const PRODUCTION_HOSTS = [CANONICAL_HOST, 'statwindow.app', 'stat-window.vercel.app'] as const;
