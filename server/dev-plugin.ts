/**
 * Serves /api/scores from `vite dev` and `vite preview` with an in-memory store, so local
 * play and the browser tests exercise the real handler. Nothing is persisted or sent anywhere.
 * The server clock is real time: runs on a pinned past day come back "ineligible", as in production.
 */
import type { Plugin, Connect } from 'vite';
import { contextFromEnv, handle } from './api.ts';
import { fileSlates } from './slates.ts';
import { memoryStore } from './store.ts';

export function scoresApi(): Plugin {
  const ctx = contextFromEnv(
    { SCORES_ENABLED: '1', SCORE_HASH_SECRET: 'local-dev-only', VERCEL_ENV: 'development' },
    { store: memoryStore(), loadSlate: fileSlates() },
  );
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/scores')) return next();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      if (!headers.has('x-vercel-ip-country')) headers.set('x-vercel-ip-country', process.env.LOCAL_COUNTRY ?? 'US');
      const body = chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) });
      void handle(request, ctx).then(async (r) => {
        res.statusCode = r.status;
        r.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await r.text());
      });
    });
  };
  return {
    name: 'stat-window-scores-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}
