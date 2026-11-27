> **Privacy safety update (V3):** A daily-score DELETE only counts as successful after HTTP 200 with `status:"ok"` and a nonnegative integer `removed`. The browser immediately disables submission while deleting and preserves its original key and sent-day history on a failed or malformed response; after confirmed deletion the old key is discarded (a fresh code is generated only on the next opted-in submission), and the choice remains blocked until retry succeeds. Server DELETE searches the server-defined nine-day window (not only a possibly incomplete browser sent-day list), then writes a 9-day HMAC-only browser revocation marker in the **same atomic Redis 7 Lua script** as score removal (even if the client day list is empty). A late POST from another tab/instance checks that marker atomically and returns 409 revoked. No original browser code or personal name is stored. The additional GET/SET command costs are accounted for in `server/store.ts` `COST`; verify full CI Redis, client and browser regression before release. This does not activate the deferred global leaderboard.

# Daily score percentiles

Phase 1 (2026-11-18). Code: `server/` (bundled to `api/scores.js`), `src/engine/percentile.ts`, `src/lib/scores.ts`, `src/ui/Comparison.tsx`. Privacy notice: `docs/PRIVACY.md`.

## What the player sees

Under the score on the results screen of **today's official puzzle**:

| State | Copy |
|---|---|
| `n >= 100` | **82nd percentile today** · based on 214 eligible completed games, as of 9:41 AM. Refresh |
| `50 <= n < 100` | Percentiles unlock at 100 games today: 62 so far. Refresh |
| `n < 50` (`PERCENTILE_PROGRESS_FROM`) | no visible line; screen readers hear "Your score is in today's tally." (owner decision, 2026-11-21 UI sweep) |
| server unreachable / budget spent | Today's percentile isn't available right now. Your score is saved here. |
| consent needed (EU/EEA/UK/CH and their territories, unknown location, or GPC/DNT) | a quiet line under the score, and below the share buttons "See how today's score compares?" with two equal buttons, *Count my score* / *No thanks* |
| player said no | You're not in today's comparison. Change |
| store not configured (`SCORES_ENABLED` unset) | nothing at all |

Practice, archive and past-day challenge runs show nothing. The share text and the score card include the percentile only in the first state. The question comparison (below) never appears on the share text or the card.

## Definition

For a total `s` among `N` eligible submissions for one canonical Eastern puzzle day and season:

`p(s) = 100 × (count(score < s) + 0.5 × count(score = s)) / N`, rounded to a whole number.

Ties get half credit, so it is labelled "Xth percentile today", never "beat X% of players". The player's own score is in `N`. Later submissions can move it; the line says "as of" and offers Refresh. Unit tests: `src/engine/percentile.test.ts` (0, 500, ties, all tied, one and two players, empty, malformed).

**Threshold:** `N >= 100` (`PERCENTILE_MIN_SAMPLE`). The `PERCENTILE_MIN_SAMPLE` env var can only *raise* it: the server clamps it to at least 100 on every deployment, whatever `SCORES_NAMESPACE` is called. Only the test-only switch `SCORES_TEST_LOW_SAMPLE=1` lets it go lower, and the server ignores that switch when `VERCEL_ENV=production` or the namespace is `production`. Also, the published client independently refuses to show a percentile from fewer than 100 games. The floor keeps early numbers from swinging wildly. The sample is still self-selected: only players who finish and keep comparison on are in it. Below it the API returns only `n`, never buckets, so a tiny day can't reveal one person's score.

## Question comparison (V5.1)

Code: `verifyRun` in `server/api.ts`, the scripts in `server/store.ts`, `summarizeQuestion`/`questionCrowdLine`/`toughestQuestion` in `src/engine/percentile.ts`, `prefetchQuestionCrowd`/`questionCrowdFor` in `src/lib/scores.ts`, one line in `src/ui/Round.tsx`, one line in `src/ui/Results.tsx`. Tests: `server/crowd.test.ts`, `server/client.test.ts`, `server/redis.test.ts`.

**What the player sees.** After a round of today's official run is locked and revealed, under the answer note, at most one line, and only if that question has a publishable sample:

| Round result | Copy |
|---|---|
| scored 1 to 100 points | **74th percentile for this question, among 214 eligible completed games.** |
| 0 points (miss, too-wide catch or shot-clock violation) | **38% of 214 eligible completed games scored on this question.** (no claim about *why* this player got 0) |
| below the gate, share suppressed, paused, offline, stale, malformed, another question id | nothing (no placeholder, no spinner) |

On the results screen, at most one extra quiet line: *Toughest for the crowd today: Question 3, scored in 21% of 214 eligible completed games*, only when all five questions are publishable and one has a strictly lowest scoring share. Nothing on the share text or score card. Practice, Survival, archive, past-day challenges and QA show nothing.

**Data path.** No new endpoint and no new request type. The existing POST already sends the five windows for verification; the server re-scores them and derives one outcome per question, then the *same* submit script that stores the total adds the five outcomes to the day's question hash (or does nothing to it). The windows are never stored. The browser reads the question summaries in the *same* edge-cached `GET ?day=` that serves the percentile, started when today's official run opens (at most one per day per page; the results screen's refresh reuses it); a round's line is a synchronous snapshot taken when the round resolves, so the answer, score, court, NBA context, clock and Next never wait on it. The read is made only where the comparison would be sent without asking (not after *No thanks*, with GPC/DNT, once the location is known to be ask-first, during deletion or in QA). A first-time visitor whose location is not known yet does make this one anonymous read; it carries no browser code and stores nothing.

**Definitions.**
- *Eligible population* for a question: completed games stored for that canonical Eastern day, season and environment (first completion per browser code, verified against the published slate) **that were stored with question outcomes**. Its size `n_q` is reported per question; it is not assumed to equal the day's total `N`.
- *Historical total-only records* (stored before V5.1, or past the question ceiling) are never counted as question contributions and no outcome is invented for them. Because a single total-only record past the ceiling would make the question sample incomplete, the day is then flagged and its question statistics withheld.
- *Outcomes*, decided by the server from the verified window alone: `t` shot-clock violation (the window is the full scale: every client records a timeout that way, and the game never lets a player lock the full scale; a crafted request posting the full scale is classified the same way and scores 0 either way); `m` miss (the window does not contain the answer); `z` zero-point catch (contains the answer but too wide to score); `1..100` a scoring catch. A miss is never inferred from 0 points.
- *Scoring hit*: a round worth at least 1 point. The published share is `scored = round(100 × scoring / n_q)`. Misses, zero-point catches and timeouts are all non-scoring. (`missed`, the share of window misses with timeouts excluded, is published by the API but not shown yet.)
- *Points percentile*: midrank over the 0–100 points histogram with every zero-point outcome at 0: `p(x) = 100 × (count(points < x) + 0.5 × count(points = x)) / n_q`, rounded. Ties get half credit. The line is computed at the reveal, before the run is submitted, so the player's own game is *not* yet in `n_q`; the copy says "Xth percentile for this question", never "beat X%". Shown in steps of 5 and between the 5th and 95th (never "0th" or "100th"), only for a scoring round; a zero-point round gets the crowd's scoring share instead.
- *Sample gate*: per question, `n_q ≥ 100` (the same production minimum as the overall percentile, enforced by the server and again by the published client). Below it the API returns only `{id, n, ready: false}`.
- *Small cells*: a share is published only when the cell and its complement each hold at least 5 games (`SMALL_CELL`); otherwise that share is omitted. The percentile table is withheld too while the zero cell or the scoring cell holds 1–4 games (it would otherwise reveal the count the share hides), and it is published in steps of 5 (`PCT_STEP`), so neighbouring entries can't be differenced back into single-game cells. This is coarsening, not anonymisation: the data are anonymous outcome counts per question with no link to any browser.
- *Freshness*: the GET is cached 5 minutes at the edge (stale-while-revalidate 10 minutes); the browser drops a summary older than 30 minutes by its `asOf`, or dated in the future. Lines are a snapshot at reveal and are not live-updated.
- *Mixed client versions*: every client already sends the windows, so old and new clients contribute identically; the server, not the client, decides outcomes.

**Deletion and revocation.** DELETE takes back, in its one atomic script, the linked record's total *and* its five outcomes, and writes the revocation tombstone; a POST in flight that reaches Redis after it is refused (409) and adds nothing. A deleted total-only record touches only the totals. After 7 days a record is no longer linked; the remaining counts are anonymous, exactly as for totals.

**Isolation.** Keys are partitioned by environment, season (including `qa`), canonical day and question id; reads never cross them. All environments charge one shared budget, so preview or QA traffic can only pause comparisons sooner, never push Upstash over its quota.

## Eligibility (server decides, from its own clock)

- `day` is today in New York, or yesterday during the first 2 hours after midnight Eastern (a run started before midnight).
- The five windows match today's published slate exactly: same question ids in order, on the step grid, inside the scale, at least one step wide. The server re-scores them with `src/engine/scoring.ts` (the same code the game uses); a client `total` that disagrees is rejected.
- One per browser code per day per season: **first stored wins** (`SET` only if absent inside one Lua script). A refresh, a retry or 20 simultaneous tabs count once and get the first score back (`duplicate`).
- A first play of today's puzzle that arrived through a friend's `?day=…&vs=…` link is eligible (the client marks it a daily run; the `vs` value is never sent). Past-day challenge links and archive practice are not.
- Season comes from the committed `LAUNCH_DAY` (`src/engine/launch-config.ts`), never from the client. `test: true` (set by `?qa=1`, remembered) goes to season `qa`, which no ranking reads. Preview and development deployments write under their own key prefix (`sw:v1:preview:…`), never production. On Vercel the function **fails closed**: if `VERCEL_ENV` is missing (and no `SCORES_NAMESPACE` is set), or `SCORE_HASH_SECRET` is missing or shorter than 32 characters, it collects nothing.

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
| `sw:v1:{env}:{season}:{day}:q` | hash | `{questionId}:{t\|m\|z\|1..100}` → count; the field `!` marks a day whose question sample is incomplete (capacity) | 400 days |
| `sw:v1:{env}:{season}:{day}:sub:{hmac}` | string | the stored total, then (from V5.1, unless stored past the question ceiling) the five `{questionId}:{outcome}` fields it added, space-separated; nothing else from the windows | 7 days |
| `sw:v1:{env}:rl:{hmac(ip, day)}:{minute}` | counter | POST/DELETE requests this minute | 120 s |
| `sw:v1:{env}:ipd:{hmac(ip, day)}` | counter | scores stored from this network today | 26 h |
| `sw:v1:{env}:ipc:{hmac(ip, day)}` | counter | POST submissions from this network today (stored, duplicate or capped) | 26 h |
| `sw:v1:{env}:ipdel:{hmac(ip, day)}` | counter | DELETE requests from this network today | 26 h |
| `sw:v1:{env}:revoked:{hmac(browser code)}` | string | revocation marker written by DELETE; a later POST for that code is refused | 9 days |
| `sw:v1:budget:d:{utcDay}` | counter | estimated Upstash commands today, all environments | 2 days |
| `sw:v1:budget:m:{YYYY-MM}` | counter | estimated Upstash commands this month, all environments | 32 days |
| `sw:v1:budget:r:{utcDay}` | counter | estimated commands spent by reads (GET) today, all environments | 2 days |
| `sw:v1:budget:e:{YYYY-MM}` | counter | estimated Upstash commands spent on deletion this month (its own counter, capped at the erase reserve) | 32 days |

`hmac` = HMAC-SHA-256 with `SCORE_HASH_SECRET`, truncated. `ip` is the IPv4 address or the IPv6 /64. Raw browser codes and IPs are never stored. `n` is recomputed from the buckets on read. Every write path is one Lua `EVAL`, atomic on the server. `server/redis.test.ts` runs the production scripts on a real `redis-server` in CI.

## Abuse and integrity limits

Perfect anti-cheat is impossible: the game and future slates are public static files, so anyone can compute a perfect window and post it, and anyone can mint new browser codes. What we do:

- re-score on the server; reject anything off-slate, off-grid, malformed or over 2 KB;
- same-origin check (`Origin`/`Sec-Fetch-Site`), JSON content type (forces a CORS preflight we don't answer);
- 6 POST/DELETE requests per minute per hashed network, checked *before* anything is charged to the budget, and remembered in the function instance for the rest of the minute so a flood stops reaching the store;
- at most 5 DELETE requests per network per UTC day, checked before anything is charged and then remembered by the instance until 00:00 UTC (under its own memo key, so it never blocks that network's submissions). Deletion spends its own monthly counter, never the shared one, so a deletion flood can't pause submissions or reads for anyone;
- at most 40 submissions (stored, duplicate or capped) per network per UTC day, checked before anything is charged and then remembered by the instance until 00:00 UTC (under its own memo key, so deletion still works); a resend of a run already stored is recognised *before* the full charge and costs 14 instead of 27. A submission past the 30-score cap is charged the full 27 before it is refused, so one network can spend at most 40 × 27 = 1,080 of the 14,000 daily commands, however long it resends;
- at most 30 stored scores per network per UTC day, so one address can't fill a day's cohort (a large school or carrier NAT sharing one address may hit it; they then see "isn't available right now", and play is unaffected);
- GET accepts only the exact raw query `?day=YYYY-MM-DD` (no extra `&`, no percent-encoded variants), so junk query strings can't bypass the 5-minute edge cache;
- hard daily and monthly command budgets across all endpoints (below);
- sample gate before any number is shown.

Treat percentiles as a friendly comparison among unverified browsers. A real leaderboard needs accounts and server-held slates (Phase 2+). If a day shows an implausible spike of 500s, export it (below) and note it.

## Cost ($0)

- **Upstash Free, verified 2026-11-26** on [Pricing & Limits](https://upstash.com/docs/redis/overall/pricing): 500K commands/month, 250 MB data (256 MB in the comparison table), 10 GB bandwidth/month, 10,000 commands/second, 10 MB max request, 100 MB max record, 1 database. Our database: created 2026-11-18 via the Vercel Marketplace, plan "Free", region iad1, no card on file. Without a card the plan cannot be billed; over the monthly limit "the exceeding commands return an exception" ([Upstash FAQ](https://upstash.com/docs/redis/help/faq)), which the app shows as "isn't available right now".
- Upstash bills a script as "one command, plus one command for every `redis.call` or `redis.pcall` the script runs" ([billing](https://upstash.com/docs/redis/overall/billing)); pipelines and transactions are billed per command too. Each script checks the counters first and, unless paused, charges its upper bound before doing anything else (`server/store.ts` `COST`). A paused call charges nothing, so it can't eat the deletion reserve. `server/redis.test.ts` counts every `redis.call` on real Redis and checks that no path runs more than it is charged.

| Operation | Billed commands (EVAL + calls inside) | Charged to | Notes |
|---|---|---|---|
| First completion, with the five question outcomes | ≤ 26 | 27, day + month | was 21 before V5.1 (5 HINCRBY + 1 EXPIRE added) |
| First completion past the question ceiling (total only) | ≤ 22 | 23, day + month | sets the day's `!` flag (HSET + EXPIRE) |
| Duplicate (resend, retry, racing tab) | 14 | 14, day + month | recognised before the full charge; question tally untouched |
| POST limited per minute / per network per day | ≤ 3 / ≤ 5 | nothing | then memoised by the instance (minute / until 00:00 UTC) |
| POST for a revoked code | ≤ 6 | nothing | answered 409 |
| POST while paused | ≤ 9 | nothing | then memoised until 00:00 UTC or the 1st |
| Consent probe, ineligible, invalid body | 0 | — | never reaches Redis |
| GET (one edge-cache miss; carries the totals *and* the five question summaries) | ≤ 12 | 12, day + month + reads | was 8; cached 5 min at the edge, so cost scales with cache misses, not players |
| GET while paused / reads ceiling | ≤ 4 | nothing | then memoised |
| DELETE, upper bound (27 day/season pairs: 9 days × beta, s1 and QA, every record with questions) | ≤ 387 = 9 + 14 × 27 | checked against erase reserve | before V5.1: 9 + 4 × 18 = 81 (18 pairs, no question fields) |
| DELETE, actually charged | 9 + 1/pair + 3/record + 2/question field | erase counter only | typical (1 record with questions, 27 pairs): 9 + 27 + 3 + 10 = 49 |
| Revocation only (no linked record) | 36 = 9 + 27 | erase counter only | the tombstone is written in the same script |

- **Ceilings** (`server/api.ts` `DEFAULT_LIMITS`), shared by every environment (production, preview, development, QA all charge `sw:v1:budget:*`): **monthly 380,000** (`SCORES_MONTHLY_BUDGET` can only lower it), **daily 14,000** (`SCORES_DAILY_BUDGET`). Inside those, explicit ceilings for the new load: **reads ≤ 4,000 a day** (`readDailyBudget`; past it only GET pauses), and the **question comparison stops being written or read once the day counter would pass 12,000 or the month counter 340,000** (`questionDailyCeiling`, `questionMonthlyCeiling`). A lowered `SCORES_DAILY_BUDGET`/`SCORES_MONTHLY_BUDGET` lowers these in proportion (2/7, 6/7 and 17/19), so the question comparison always pauses first and the overall percentile keeps working longest. Deletion keeps its own 20,000/month reserve, usable even when everything else is paused. The remaining ~100K/month covers uncharged limited and paused calls, the export script and console use.
- **Pausing safely at capacity.** Past the question ceiling a first completion is still stored (total only, cost 23) and the day is flagged `!`: from then on that day's question statistics are withheld for everyone (a partial sample would be biased toward early players), the GET still reads the question hash (its cost is charged) but the API withholds the questions, and the browser shows no question line. Past the daily or monthly budget everything optional returns 503 `paused`; gameplay, the score, Next and sharing never wait on any of it.
- **Capacity estimate (from the cost model above).** Per day with questions on: (12,000 − reads) / 27 first completions, i.e. about 400 a day with ~1,000 commands of reads, and at least 296 a day even if reads use their whole 4,000. Reads are the uncertain part: every official run now starts one GET, and Vercel's edge cache is per region, so misses grow with regions × 288 five-minute windows × 2 day keys rather than with players. ~85 misses a day is a one-region estimate; across 2–3 busy regions the 4,000-command read ceiling (333 misses) can be reached, and then GET pauses for the rest of the UTC day (the crowd lines and Refresh disappear; scores and gameplay are unaffected and nothing is spent past the ceiling). Watch `budget:r` in the first busy week. Sustained over a 30-day month the question ceiling allows 340,000 / 30 ≈ 11,300 a day, i.e. about 380 completions a day with ~1,000 of reads. Past that, roughly 85 more a day are stored total-only before the 14,000 daily budget pauses everything. Before V5.1 the same budget allowed about 666 first completions a day (21 each); the question comparison costs about a third of that headroom. Since a question shows statistics only from 100 games, days below 100 completions show nothing new and cost only the 6 extra commands per completion. Deletion: the erase reserve covers ≥ 51 worst-case deletions a month (387 each; no real browser has records on all 27 pairs) and about 400 typical ones. DELETE searches every season that has ever held records (`SEASONS` in `src/engine/season.ts`), whatever the launch day is set to now, so records survive an emergency rollback's configuration change; one network can make at most 5 a day. These are estimates of what the scripts charge, checked against real Redis, not measured Upstash billing; verify against the Upstash console's usage after the first busy week.
- When a budget is spent the instance remembers it (until 00:00 UTC, or the 1st of next month) and stops calling the store at all; every other instance pays one short uncharged call to learn the same.
- Concurrency: every check-and-charge happens inside one script, which Redis runs atomically, so racing requests on any number of instances can't overshoot a ceiling by more than one call's charge, and 20 tabs submitting at once store once and charge one full and nineteen duplicate costs.
- Remaining risk: a deliberate distributed flood (many addresses) still costs about 2 to 6 commands per request before it is limited, and could use up the free month early. The consequence is that percentiles and question comparisons stop until the next month; nothing is billed. If that ever happens, the optional mitigation is one Vercel WAF rate-limit rule on `/api/scores` (Hobby includes one rule and 1M allowed requests; check the pricing dialog shows $0 before saving it). Not set up.
- GET responses are cached at Vercel's edge for 5 minutes (`s-maxage=300`).
- Vercel Hobby: functions are well inside 1M invocations / 4 CPU-hours; over a Hobby limit Vercel pauses, it does not bill.
- Data size: per day one totals hash (≤ 501 fields) and one question hash (≤ 5 × 103 + 1 = 516 fields) + short-lived small strings (a linked record is now at most about 6 short tokens). Years of days fit in well under 250 MB.

## Configuration (Vercel project → Settings → Environment Variables)

| Name | Scope | Value |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) | Production, Preview | added by the Upstash integration |
| `SCORES_ENABLED` | Production (and Preview to test) | `1` |
| `SCORE_HASH_SECRET` | Production, Preview | **required on Vercel**: 32+ random characters, its own value (never the store token). Changing it unlinks the last 7 days of records (first-wins and deletion restart) |
| `SCORES_DAILY_BUDGET` | optional | default 14000 estimated commands |
| `SCORES_MONTHLY_BUDGET` | optional | default and maximum 380000 |
| `SCORES_NAMESPACE` | optional | overrides the environment prefix (lowercase, ≤ 24 chars). It never changes the 100-game floor |
| `PERCENTILE_MIN_SAMPLE` | optional | raises the sample threshold (never below 100) |
| `SCORES_TEST_LOW_SAMPLE` | tests only, never Production | `1` lets `PERCENTILE_MIN_SAMPLE` go below 100; ignored on production deployments |
| `LAUNCH_DAY`, `VITE_LAUNCH_DAY` | never: delete from every environment, Preview included | the launch day is committed in `src/engine/launch-config.ts`; a build fails if either is set to a different value (`docs/LAUNCH.md`) |

## Emergency disable / rollback

1. **Stop new submissions fast:** set `SCORES_ENABLED` to `0` and redeploy (or use *Instant Rollback* to the previous deployment). The client then shows nothing; play and sharing are unaffected. "Delete my scores" keeps working while the store and secret are configured.
2. **Stop analytics:** set `VITE_ANALYTICS` to `off` and redeploy.
3. **Code rollback:** revert the merge commit. Saved games are untouched (this feature only adds a separate `stat-window:privacy:v1` key in localStorage).
4. **Data:** distributions are aggregates; to wipe a day, delete its `…:dist` key in the Upstash console.

## Backup / export

`node --experimental-strip-types scripts/scores-export.ts --from 2026-11-18 --to 2026-12-01 --json > scores.json` (aggregates only). Run monthly if you want history beyond 400 days.

## Migration

Key prefix is versioned (`sw:v1`). A schema change writes `sw:v2:*` and reads both during a transition; never rewrite `v1` in place.

## QA readings (from the 2026-11-21 UI sweep)
QA scores (`?qa=1`) are stored in the `qa` season, but `GET /api/scores` reads only the public season. So in QA the client never uses the GET: on reload, and on Refresh, it sends the run again and reads the `qa` tally from the server's `duplicate` answer (first completion still wins). The double GET reported in the sweep did not reproduce on the Chromium preview build; `e2e/sweep.spec.ts` asserts exactly one request on a normal reload.

