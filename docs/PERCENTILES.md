# Daily score percentiles

Phase 1 (2026-11-18). Code: `server/` (bundled to `api/scores.js`), `src/engine/percentile.ts`, `src/lib/scores.ts`, `src/ui/Comparison.tsx`. Privacy notice: `docs/PRIVACY.md`.

## What the player sees

Under the score on the results screen of **today's official puzzle**:

| State | Copy |
|---|---|
| `n >= 100` | **82nd percentile today** · based on 214 eligible completed games, as of 9:41 AM. Refresh |
| `n < 100` | Not enough completed games for today's percentile yet (37 of 100 needed). Refresh |
| server unreachable / budget spent | Today's percentile isn't available right now. Your score is saved here. |
| consent needed (EU/EEA/UK/CH and their territories, unknown location, or GPC/DNT) | a quiet line under the score, and below the share buttons "See how today's score compares?" with two equal buttons, *Count my score* / *No thanks* |
| player said no | You're not in today's comparison. Change |
| store not configured (`SCORES_ENABLED` unset) | nothing at all |

Practice, archive and past-day challenge runs show nothing. The share text and the score card include the percentile only in the first state.

## Definition

For a total `s` among `N` eligible submissions for one canonical UTC puzzle day and season:

`p(s) = 100 × (count(score < s) + 0.5 × count(score = s)) / N`, rounded to a whole number.

Ties get half credit, so it is labelled "Xth percentile today", never "beat X% of players". The player's own score is in `N`. Later submissions can move it; the line says "as of" and offers Refresh. Unit tests: `src/engine/percentile.test.ts` (0, 500, ties, all tied, one and two players, empty, malformed).

**Threshold:** `N >= 100` (`PERCENTILE_MIN_SAMPLE`). The `PERCENTILE_MIN_SAMPLE` env var can only *raise* it in production (the server clamps it to at least 100), and the published client independently refuses to show a percentile from fewer than 100 games. The floor keeps early numbers from swinging wildly. The sample is still self-selected: only players who finish and keep comparison on are in it. Below it the API returns only `n`, never buckets, so a tiny day can't reveal one person's score.

## Eligibility (server decides, from its own clock)

- `day` is today in UTC, or yesterday during the first 2 hours after 00:00 UTC (a run started before midnight).
- The five windows match today's published slate exactly: same question ids in order, on the step grid, inside the scale, at least one step wide. The server re-scores them with `src/engine/scoring.ts` (the same code the game uses); a client `total` that disagrees is rejected.
- One per browser code per day per season: **first stored wins** (`SET` only if absent inside one Lua script). A refresh, a retry or 20 simultaneous tabs count once and get the first score back (`duplicate`).
- A first play of today's puzzle that arrived through a friend's `?day=…&vs=…` link is eligible (the client marks it a daily run; the `vs` value is never sent). Past-day challenge links and archive practice are not.
- Season comes from server config (`LAUNCH_DAY`), never from the client. `test: true` (set by `?qa=1`, remembered) goes to season `qa`, which no ranking reads. Preview and development deployments write under their own key prefix (`sw:v1:preview:…`), never production. On Vercel the function **fails closed**: if `VERCEL_ENV` is missing (and no `SCORES_NAMESPACE` is set), or `SCORE_HASH_SECRET` is missing or shorter than 32 characters, it collects nothing.

## Consent flow

Nothing identifying is sent before a yes.

1. A player who hasn't chosen finishes today's daily. The client sends a *probe*: `{day, consent: "default"}`, with no browser code and no windows. No code is created yet.
2. The server checks `x-vercel-ip-country` first. In a consent country (or unknown) it answers `409 consent-required`; the client remembers "this location asks first" (so next time the question appears without a round trip, and the Privacy switch shows off).
3. Otherwise it answers `proceed`, and only then does the client create its random code and send the run.
4. *Count my score* sends the run with `consent: "granted"`. *No thanks* sends nothing and is remembered. Browsers with GPC/DNT are asked first, everywhere, without any request.
5. Once the server confirms a day is stored, later visits only `GET` the edge-cached tally.

## Storage (Upstash Redis, free plan)

Keys (`env` = production | preview | development):

| Key | Type | Content | TTL |
|---|---|---|---|
| `sw:v1:{env}:{season}:{day}:dist` | hash | `{score}` → count | 400 days |
| `sw:v1:{env}:{season}:{day}:sub:{hmac}` | string | the stored total | 7 days |
| `sw:v1:{env}:rl:{hmac(ip, day)}:{minute}` | counter | POST/DELETE requests this minute | 120 s |
| `sw:v1:{env}:ipd:{hmac(ip, day)}` | counter | scores stored from this network today | 26 h |
| `sw:v1:{env}:ipc:{hmac(ip, day)}` | counter | POST submissions from this network today (stored, duplicate or capped) | 26 h |
| `sw:v1:{env}:ipdel:{hmac(ip, day)}` | counter | DELETE requests from this network today | 26 h |
| `sw:v1:budget:d:{utcDay}` | counter | estimated Upstash commands today, all environments | 2 days |
| `sw:v1:budget:m:{YYYY-MM}` | counter | estimated Upstash commands this month, all environments | 32 days |
| `sw:v1:budget:e:{YYYY-MM}` | counter | estimated Upstash commands spent on deletion this month (its own counter, capped at the erase reserve) | 32 days |

`hmac` = HMAC-SHA-256 with `SCORE_HASH_SECRET`, truncated. `ip` is the IPv4 address or the IPv6 /64. Raw browser codes and IPs are never stored. `n` is recomputed from the buckets on read. Every write path is one Lua `EVAL`, atomic on the server. `server/redis.test.ts` runs the production scripts on a real `redis-server` in CI.

## Abuse and integrity limits

Perfect anti-cheat is impossible: the game and future slates are public static files, so anyone can compute a perfect window and post it, and anyone can mint new browser codes. What we do:

- re-score on the server; reject anything off-slate, off-grid, malformed or over 2 KB;
- same-origin check (`Origin`/`Sec-Fetch-Site`), JSON content type (forces a CORS preflight we don't answer);
- 6 POST/DELETE requests per minute per hashed network, checked *before* anything is charged to the budget, and remembered in the function instance for the rest of the minute so a flood stops reaching the store;
- at most 5 DELETE requests per network per UTC day, checked before anything is charged and then remembered by the instance until 00:00 UTC (under its own memo key, so it never blocks that network's submissions). Deletion spends its own monthly counter, never the shared one, so a deletion flood can't pause submissions or reads for anyone;
- at most 40 submissions (stored, duplicate or capped) per network per UTC day, checked before anything is charged and then remembered by the instance until 00:00 UTC (under its own memo key, so deletion still works); a resend of a run already stored is recognised *before* the full charge and costs 13 instead of 20. One network can therefore spend at most about 800 of the 14,000 daily commands, however long it resends;
- at most 30 stored scores per network per UTC day, so one address can't fill a day's cohort (a large school or carrier NAT sharing one address may hit it; they then see "isn't available right now", and play is unaffected);
- GET accepts only the exact raw query `?day=YYYY-MM-DD` (no extra `&`, no percent-encoded variants), so junk query strings can't bypass the 5-minute edge cache;
- hard daily and monthly command budgets across all endpoints (below);
- sample gate before any number is shown.

Treat percentiles as a friendly comparison among unverified browsers. A real leaderboard needs accounts and server-held slates (Phase 2+). If a day shows an implausible spike of 500s, export it (below) and note it.

## Cost ($0)

- Upstash Free: 500,000 commands/month, 250 MB, 1 database, no card on file (created 2026-11-18 via the Vercel Marketplace, plan "Free", region iad1). Without a card the plan cannot be billed; over the monthly limit "the exceeding commands return an exception" ([Upstash FAQ](https://upstash.com/docs/redis/help/faq)), which the app shows as "isn't available right now".
- Upstash bills a script as "one command, plus one command for every `redis.call`" ([billing](https://upstash.com/docs/redis/overall/billing)). Each script checks the counters first and, unless paused, charges its upper bound before doing anything else: submit 20 (13 for a duplicate, which is recognised first), read 8. A paused call charges nothing (so it can't eat the deletion reserve) (`server/store.ts` `COST`). Delete checks its upper bound (8 + 4 per day/season pair) against the erase reserve first, then charges what it really ran: 8 + 1 per pair + 3 per record that existed, to the erase counter only.
- **Monthly ceiling: 380,000** estimated commands across all environments (`SCORES_MONTHLY_BUDGET` can only lower it). **Daily: 14,000** (`SCORES_DAILY_BUDGET`), roughly 700 first completions a day, so one busy day can't spend the month. The remaining ~120K/month covers rate-limited and paused calls, the deletion reserve (20,000 on its own counter, usable even when everything else is paused; one network can spend at most 5 deletions a day of it) and the export script.
- When a budget is spent the instance remembers it (until 00:00 UTC, or the 1st of next month) and stops calling the store at all; every other instance pays one short call (about 5 to 7 real commands, uncharged) to learn the same.
- Remaining risk: a deliberate distributed flood (many addresses) still costs about 3 to 5 commands per request before it is limited, and could use up the free month early. The consequence is that percentiles stop until the next month; nothing is billed. If that ever happens, the optional mitigation is one Vercel WAF rate-limit rule on `/api/scores` (Hobby includes one rule and 1M allowed requests; check the pricing dialog shows $0 before saving it). Not set up in Phase 1.
- GET responses are cached at Vercel's edge for 5 minutes (`s-maxage=300`).
- Vercel Hobby: functions are well inside 1M invocations / 4 CPU-hours; over a Hobby limit Vercel pauses, it does not bill.
- Data size: one hash per day (≤ 501 fields) + short-lived small strings. Years of days fit in a few MB.

## Configuration (Vercel project → Settings → Environment Variables)

| Name | Scope | Value |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) | Production, Preview | added by the Upstash integration |
| `SCORES_ENABLED` | Production (and Preview to test) | `1` |
| `SCORE_HASH_SECRET` | Production, Preview | **required on Vercel**: 32+ random characters, its own value (never the store token). Changing it unlinks the last 7 days of records (first-wins and deletion restart) |
| `SCORES_DAILY_BUDGET` | optional | default 14000 estimated commands |
| `SCORES_MONTHLY_BUDGET` | optional | default and maximum 380000 |
| `SCORES_NAMESPACE` | optional | overrides the environment prefix (lowercase, ≤ 24 chars) |
| `LAUNCH_DAY` | only at formal launch | see `docs/LAUNCH.md` |

## Emergency disable / rollback

1. **Stop new submissions fast:** set `SCORES_ENABLED` to `0` and redeploy (or use *Instant Rollback* to the previous deployment). The client then shows nothing; play and sharing are unaffected. "Delete my scores" keeps working while the store and secret are configured.
2. **Stop analytics:** set `VITE_ANALYTICS` to `off` and redeploy.
3. **Code rollback:** revert the merge commit. Saved games are untouched (this feature only adds a separate `stat-window:privacy:v1` key in localStorage).
4. **Data:** distributions are aggregates; to wipe a day, delete its `…:dist` key in the Upstash console.

## Backup / export

`node --experimental-strip-types scripts/scores-export.ts --from 2026-11-18 --to 2026-12-01 --json > scores.json` (aggregates only). Run monthly if you want history beyond 400 days.

## Migration

Key prefix is versioned (`sw:v1`). A schema change writes `sw:v2:*` and reads both during a transition; never rewrite `v1` in place.
