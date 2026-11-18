/**
 * Vercel Function entry, bundled by `npm run api:build` into api/scores.js (a single
 * file with no imports beyond Node built-ins, so Vercel runs exactly the tested code).
 */
import { contextFromEnv, handle, type ApiContext } from './api.ts';
import { fileSlates } from './slates.ts';
import { redisStore, upstashEval } from './store.ts';

let ctx: ApiContext | null = null;
function context(): ApiContext {
  if (ctx) return ctx;
  const env = process.env;
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  ctx = contextFromEnv(env, { store: url && token ? redisStore(upstashEval(url, token)) : null, loadSlate: fileSlates() });
  return ctx;
}

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, context());
  },
};
