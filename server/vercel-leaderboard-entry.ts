import { handleLeaderboard, leaderboardContext, type LBContext } from './leaderboard.ts';
import { leaderboardRedis } from './leaderboard-store.ts';
import { upstashEval } from './store.ts';
import { fileSlates } from './slates.ts';
let context: LBContext | null = null;
export default { fetch(request: Request): Promise<Response> {
  if(!context) {
    const env=process.env,url=env.UPSTASH_REDIS_REST_URL??env.KV_REST_API_URL,token=env.UPSTASH_REDIS_REST_TOKEN??env.KV_REST_API_TOKEN;
    context=leaderboardContext(env,url&&token?leaderboardRedis(upstashEval(url,token)):null,fileSlates());
  }
  return handleLeaderboard(request,context);
} };
