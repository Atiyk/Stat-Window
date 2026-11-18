# Daily score percentiles

Phase 1 (2026-11-18). Code: `server/` (bundled to `api/scores.js`), `src/engine/percentile.ts`, `src/lib/scores.ts`, `src/ui/Comparison.tsx`. Privacy notice: `docs/PRIVACY.md`.

## What the player sees

Under the score on the results screen of **today's official puzzle**:

| State | Copy |
|---|---|
| `n >= 100` | **82nd percentile today** · based on 214 eligible completed games, as of 9:41 AM. Refresh |
| `n < 100` | Not enough completed games for today's percentile yet (37 of 100 needed). Refresh |
| server unreachable / budget spent | Today's percentile isn't available right now. Your score is saved here. |
| consent needed (EU/EEA/UK/CH, unknown location, or GPC/DNT) | "See how today's score compares?" with *Count my score* / *No thanks* |
| player said no | You're not in today's comparison. Change |
| store not configured (`SCORES_ENABLED` unset) | nothing at all |

Practice, archive and past-day challenge runs show nothing. The share text and the score card include the percentile only in the first state.

## Definition

For a total `s` among `N` eligible submissions for one canonical UTC puzzle day and season:

`p(s) = 100 × (count(score < s) + 0.5 × count(score = s)) / N`, rounded to a whole number.

Ties get half credit, so it is labelled "Xth percentile today", never "beat X% of players". The player's own score is in `N`. Later submissions can move it; the line says "as of" and offers Refresh. Unit tests: `src/engine/percentile.test.ts` (0, 500, ties, all tied, one and two players, empty, malformed).

**Threshold:** `N >= 100` (`PERCENTILE_MIN_SAMPLE`, server override `PERCENTILE_MIN_SAMPLE` env). It is a product-quality floor so early numbers aren't wildly unstable, not a claim of representativeness: players who finish and keep comparison on are self-selected. Below it the API returns only `n`, never buckets, so a tiny day can't reveal one person's score.

## Eligibility (server decides, from its own clock)

- `day` is today in UTC, or yesterday during the first 2 hours after 00:00 UTC (a run started before midnight).
- The five windows match today's published slate exactly: same question ids in order, on the step grid, inside the scale, at least one step wide. The server re-scores them with `src/engine/scoring.ts` (the same code the game uses); a client `total` that disagrees is rejected.
- One per browser code per day per season: **first stored wins** (`SET` only if absent inside one Lua script). A refresh, a retry or 20 simultaneous tabs count once and get the first score back (`duplicate`).
- A first play of today's puzzle that arrived through a friend's `?day=…&vs=…` link is eligible (the client marks it a daily run; the `vs` value is never sent). Past-day challenge links and archive practice are not.
- Season comes from server config (`LAUNCH_DAY`), never from the client. `test: true` (set by `?qa=1`, remembered) goes to season `qa`, which no ranking reads. Preview and development deployments write under their own key prefix (`sw:v1:preview:…`), never production.

## Storage (Upstash Redis, free plan)

Keys (`env` = production | preview | development):

| Key | Type | Content | TTL |
|---|---|---|---|
| `sw:v1:{env}:{season}:{day}:dist` | hash | `{score}` → count, plus `n` | 400 days |
| `sw:v1:{env}:{season}:{day}:sub:{hmac}` | string | the stored total | 7 days |
| `sw:v1:{env}:budget:{utcDay}` | counter | store operations today | 2 days |
| `sw:v1:{env}:rl:{hmac(ip, day)}:{minute}` | counter | submissions this minute | 120 s |

`hmac` = HMAC-SHA-256 with `SCORE_HASH_SECRET` (falls back to the store token), truncated. Raw browser codes and IPs are never stored. `n` is recomputed from the buckets on read. Every write path is one Lua `EVAL`, atomic on the server. `server/redis.test.ts` runs the production scripts on a real `redis-server` in CI.

## Abuse and integrity limits (honest version)

Perfect anti-cheat is impossible: the game and future slates are public static files, so anyone can compute a perfect window and post it, and anyone can mint new browser codes. What we do:

- re-score on the server; reject anything off-slate, off-grid, malformed or over 2 KB;
- same-origin check (`Origin`/`Sec-Fetch-Site`), JSON content type (forces a CORS preflight we don't answer);
- 6 submissions per minute per hashed IP; a hard daily budget across all endpoints (below);
- sample gate before any number is shown.

Treat percentiles as a friendly comparison among anonymous browsers, not a verified leaderboard. If a day shows an implausible spike of 500s, export it (below) and note it; a real leaderboard needs accounts and server-held slates (Phase 2+).

## Cost: $0 by construction

- Upstash Free: 500,000 commands/month, 256 MB, 1 database, no card on file (created 2026-11-18 via the Vercel Marketplace, plan "Free", region iad1). Without a card the plan cannot be billed.
- We assume the worst case that every `redis.call` inside a script is billed: a submission is ≤ 10 calls, a read ≤ 3. `SCORES_DAILY_BUDGET` defaults to **1,500 operations/day** → ≤ 15,000 commands/day ≈ 450,000/month. When the day's budget is spent, every endpoint returns `paused` and the results screen shows "isn't available right now" until 00:00 UTC. Raise the budget only after the Upstash console shows real usage per call.
- GET responses are cached at Vercel's edge for 5 minutes (`s-maxage=300`), so reads cost at most ~288 store reads per day per URL.
- Vercel Hobby: functions are well inside 1M invocations / 4 CPU-hours; over a Hobby limit Vercel pauses, it does not bill.
- Data size: one hash per day (≤ 501 fields) + short-lived small strings. Years of days fit in a few MB.

## Configuration (Vercel project → Settings → Environment Variables)

| Name | Scope | Value |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) | Production, Preview | added by the Upstash integration |
| `SCORES_ENABLED` | Production (and Preview to test) | `1` |
| `SCORE_HASH_SECRET` | Production, Preview | 32+ random characters (optional; falls back to the store token) |
| `SCORES_DAILY_BUDGET` | optional | default 1500 |
| `LAUNCH_DAY` | only at formal launch | see `docs/LAUNCH.md` |

## Emergency disable / rollback

1. **Stop new submissions fast:** set `SCORES_ENABLED` to `0` and redeploy (or use *Instant Rollback* to the previous deployment). The client then shows nothing; play and sharing are unaffected.
2. **Stop analytics:** set `VITE_ANALYTICS` to `off` and redeploy.
3. **Code rollback:** revert the merge commit. Saved games are untouched (this feature only adds a separate `stat-window:privacy:v1` key in localStorage).
4. **Data:** distributions are aggregates; to wipe a day, delete its `…:dist` key in the Upstash console.

## Backup / export

`node --experimental-strip-types scripts/scores-export.ts --from 2026-11-18 --to 2026-12-01 --json > scores.json` (aggregates only). Run monthly if you want history beyond 400 days.

## Migration

Key prefix is versioned (`sw:v1`). A schema change writes `sw:v2:*` and reads both during a transition; never rewrite `v1` in place.
