// Bootstraps Vercel's pre-build serverless-function discovery.
// npm run build overwrites this file with the vetted bundle generated from
// server/vercel-leaderboard-entry.ts; scripts/api-check.ts then validates equality.
// If compilation is bypassed, fail closed rather than serve fake rankings.
export default {
  fetch() {
    return new Response(JSON.stringify({ status: 'disabled' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
