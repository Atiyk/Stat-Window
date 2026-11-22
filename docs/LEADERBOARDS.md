# V3 opt-in global leaderboard — gated beta

The implementation is **fail-closed by default**. It must not be advertised as live before the integrator proves aggregate free-tier costs, deletion, abuse protections and independent privacy review.

## Data and semantics
- Official daily completions only. The client sends a random 22-character browser code and five windows after an **independent explicit opt-in**. Server validates the five question IDs, grid ranges, official slate and score; user-supplied total is rejected if inconsistent. One first submission per browser code/day; concurrent retries deduplicated in one Redis Lua script.
- No accounts, names or user-generated nicknames. HMAC-SHA256 with server-only secret produces a stable pseudonymous Redis member; public name is deterministically generated from the hash. No raw code or IP is stored alongside scores. A hashed IP is used only in short-lived rate counters.
- Day is midnight Eastern; week starts Monday Eastern, month Eastern calendar, season server-configured launch season. Day total is 0–500. Week/month/season score is the **sum** of first accepted daily scores. Ties have no verified tiebreaker; a pseudonym is not an authenticated human. Top 20 are shared globally.
- Each linked player record and its ranked period keys expire at 90 days. This **means season standings are rolling-retention**, not an all-time immutable historical record. Do not label them full-season when a season lasts over 90 days. Need redesign for true season persistence before activation for longer seasons.
- Deletion subtracts every still-linked daily contribution from all four periods and deletes the player hash atomically. Redis deletion reserve is separate. If deletion is unavailable, keep consent locally and show retry; never claim erased.

## Release gates / activation blockers
1. Confirm the existing percentile service's 380K monthly / 20K deletion-reserve Upstash cost accounting still holds after adding leaderboard traffic. Lua EVAL costs include every redis.call, not just the EVAL; the current leaderboard Lua upper bounds (55 submit, 12 read, 2000 deletion) must be independently measured against real Redis and reconciled with Upstash's current billing. **Do not enable until audited.**
2. The existing percentile service uses the shared budget counters and can spend all 380K before the leaderboard sees traffic; leaderboard-specific env caps cannot reserve capacity by themselves. Prove an atomic joint allocation strategy or lower existing percentile ceiling. A leaderboard 20K monthly ceiling must fit **inside** the same 380K total. Default env caps zero, `LEADERBOARDS_ENABLED` unset. A separate read-heavy leaderboard can consume significant commands.
3. The current endpoint only exposes top-20 rows, not personal rank or played-days counts. Before activation, add server-side own-rank and days-played counts without leaking code or exposing single-player query bypass. Week/month/season aggregation should be auditable and delete-safe.
4. No proof of cheat resistance: client windows can be constructed after seeing answers. Do not offer cash/prizes or call scores verified.
5. Tests must exercise Redis Lua against a real redis-server, duplicate concurrent posts, expired entries, delete all periods, DST and 90-day season expiration, consent/GPC/DNT, and security. Privacy/legal review before production.

## Configuration
`LEADERBOARDS_ENABLED=1`, `SCORES_ENABLED=1`, `LEADERBOARDS_DAILY_BUDGET` (<=1000), `LEADERBOARDS_MONTHLY_BUDGET` (<=20000), `LEADERBOARDS_ERASE_BUDGET` (<=2000), and the existing `SCORE_HASH_SECRET` and Upstash REST envs. Do not set these until the gates above pass. The endpoint `/api/leaderboard` uses GET ?period=day|week|month|season, POST and DELETE. Existing percentile endpoints remain unchanged.

## Operational warning
The initial code intentionally has not passed GitHub CI or browser tests. The source entry is bundled by `npm run api:build`; the generated `api/leaderboard.js` is not committed in this worker branch. The manager must run the build, inspect its emitted route and ensure the committed API bundle policy and build checks agree. Until then, the leaderboard is **not deployable**. The existing Redis budget caps are conservative and shared; this can make the board unavailable even when some free-tier capacity remains. This is safer than unexpected charges.
