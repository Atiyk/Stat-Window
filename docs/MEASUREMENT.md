# Measurement

Use [the V5.3 launch measurement guide](V5.3-MEASUREMENT.md) for the 30-day readout and capacity model. Keep beta counts and official season counts in separate date ranges and path prefixes.

## What is wired

`src/lib/track.ts` sends a fixed set of events to **Vercel Web Analytics**, which the project's Hobby plan includes at no cost.

- **Why page views:** on Hobby, Vercel's custom events are not available ("Custom Events are available on Enterprise and Pro plans", [Vercel docs](https://vercel.com/docs/analytics/custom-events)). So each event is sent as a *virtual page view* on a path under `/e/…`, using the package's `pageview()` call. The counts appear in the dashboard's **Pages** list, one row per path.
- **Cost:** Hobby includes 50,000 events a month across all projects on the team. Both kinds of page view count. Vercel pauses analytics collection at the limit, with no Hobby overage charge. A standard completed daily queues five core views and up to 0.7 sampled views on average. A share outcome adds one. [Vercel limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing).
- **Production hosts only.** Events are sent from the configured public hostnames on the Vercel Production target. A local build can set `VITE_ANALYTICS=vercel` for the isolated analytics test with a stubbed script. Vercel Preview and Development targets send nothing. `VITE_ANALYTICS=off` switches collection off after a deployment.
- **Production hostnames (`VITE_ANALYTICS_HOSTS`).** Unset or empty uses `www.statwindow.app,statwindow.app,stat-window.vercel.app`. An optional build-time comma-separated list replaces these defaults. Matching is exact and case-insensitive. Entries with a scheme, port, path or wildcard are ignored. Keep the legacy host in the list while it serves the game. See `analyticsHosts()` in `src/lib/track.ts`.
- **Auto-tracking is off; the real page view is sent by hand.** The Vercel script remembers the last `path` passed to `pageview()` and reuses it for later automatic page views (read from `va.vercel-scripts.com/v1/script.debug.js`, v0.1.3, on 2026-11-16), so with auto-tracking on, a real visit could be filed under a stale `/e/…` path. `startAnalytics()` injects with `disableAutoTrack: true` and sends `pageview({ route: '/', path: '/' })` once per page load.
- **Counted once.** Starts and completions use local deduplication per browser, mode and puzzle day. First touch is also deduplicated for a sampled run. The browser prunes old entries after 14 days as it records new entries. A tab adopting saved rounds skips their lock events. Blocked storage limits deduplication to the current page load.
- **Round diagnostics.** Approximately 10% of new daily starts with writable localStorage get a sampled-start event, an optional sampled first touch and up to five sampled locks. An entry in the existing deduplication ledger keeps the assignment on reload. Use sampled counts for both sides of a diagnostic ratio. Core visit, start, completion, streak, referral and share events are counted at full volume when play counts are enabled.
- **What has been proven, and what hasn't.** `npm run test:e2e:analytics` builds with `VITE_ANALYTICS=vercel`, stubs Vercel's script and checks the exact queue of page views the app hands it (funnel order, no duplicates after reloads, challenge vs daily, query string stripped, nothing at all under GPC/DNT). It does **not** prove Vercel receives them: that needs the production check in "Turning it on", step 4 (see "Production status").
- **Privacy:** no cookies or identifiers from us, no answers, no typed text, no scores beyond a 100-point band. Every path segment comes from the fixed list below. Real page-view URLs are stripped of their query string, so challenge links (`?day=…&vs=…`) are not collected. Full notice: `docs/PRIVACY.md`, served as `/privacy.html`.
- **Choices (from Phase 1, 2026-11-18).** "Privacy and your data" (results footer, and the help dialog) has an on/off switch for usage counts, stored in `stat-window:privacy:v1`. Browsers that send Global Privacy Control or Do Not Track start with it **off**; only an explicit tap in that dialog turns it on for that browser. The sink re-checks the choice before every event, so switching off stops the next event, not the next page load. Switching it on takes effect immediately (`resumeAnalytics()`): the script loads and one real page view is sent if the host allows analytics. When storage fails, the choice remains in memory for the session.
- **Cohorts.** Paths are prefixed so test and launch traffic never mix with the beta: `/e/qa/…` for any browser opened once with `?qa=1` (kept in `stat-window:qa`; use it for every manual production check), `/e/s1/…` once the formal launch is active (`docs/LAUNCH.md`). Unprefixed `/e/…` is the public beta.

### Production status (checked 2026-11-27)

| Check | Result |
|---|---|
| Web Analytics script | The branded and legacy production hosts both serve `/_vercel/insights/script.js`. |
| Dashboard configuration | `VITE_ANALYTICS_HOSTS` was absent. `VITE_ANALYTICS` was scoped to Production and contained `vercelvercel`. An unrecognized flag uses the hostname allow-list. |
| V5.3 production build (`1f80a4a`) | A clean `?qa=1` browser on www sent no analytics requests. Vercel returned HTTP 200 for the legacy host's QA start, completion and streak views. |
| V5.4 candidate | A QA browser loaded the candidate assets locally at the www origin and sent QA start, completion, streak and comparison-failure requests to Vercel's live www endpoint. Each returned HTTP 200. Verify receipt on the deployed build and in the dashboard after release. |

Treat branded traffic before the receipt check as missing measurement.

### Turning it on (owner, about two minutes)

1. Vercel dashboard → the `stat-window` project → **Analytics** → **Enable** Web Analytics (Hobby, free).
2. The production hostnames turn collection on. To switch it off, set `VITE_ANALYTICS=off` for Production before the next deploy.
3. Deploy the reviewed release through `main`.
4. Check receipt (about five minutes, from a normal browser window with no ad blocker and Do Not Track / GPC off):
   1. Open https://www.statwindow.app/?qa=1 in a dedicated test browser with DevTools → Network open, filter `view`.
   2. You should see a successful `POST …/view` for the page and each queued event. A normal daily sends start and completion, and some daily runs also send sampled round diagnostics.
   3. If you instead see a console line `[Vercel Web Analytics] Failed to load script`, step 1 or 3 is not done.
   4. Analytics → **Pages** should list `/e/qa/start/daily` and `/e/qa/complete/daily/{band}` within a few minutes. A QA visit still uses the team's allowance. The first real page view `/` has no season prefix and includes QA page loads.

Note on the Content-Security-Policy in `vercel.json` (`script-src 'self'`, `connect-src 'self'`): on Vercel the script and the endpoint are served from the site's own origin (`/_vercel/insights/…`), so the policy allows them. If step 4 shows a CSP error in the console instead, that assumption is wrong and the policy needs the endpoint added; report it rather than loosening the policy blind.

### Reading it (no dashboard to build)

Copy the Pages list for a date range (path and count per line, CSV or tab separated) into a file and run:

```bash
node --experimental-strip-types scripts/analytics-readout.ts pages.csv --cohort s1
```

It prints the funnel below with the equation used for each line, and says "not enough data" for any rate whose denominator is under 30. With today's traffic, expect that for every line. It also prints the Survival rows and, once each arm has 200 exposures, the experiment's difference with a 95% interval.

Example beta export with synthetic counts. Read it with `--cohort beta`. The command also accepts `--cohort qa`.

```text
$ cat pages.csv
/e/start/daily,40
/e/first-touch/daily,38
/e/lock/daily/r1/hit,20
/e/lock/daily/r1/miss,16
/e/complete/daily/200-299,25
$ node --experimental-strip-types scripts/analytics-readout.ts pages.csv
| daily: first touch per start | 38 | 40 | 95.0% | first-touch/daily ÷ start/daily |
| daily: finished all five per round 1 lock | 25 | 36 | 69.4% | complete/daily/* ÷ lock/daily/r1/* |
…
```

Report small numbers as counts with an interval, not as rates: 7 of 10 is "somewhere between about 40% and 90%", not "70%".

## Event dictionary

`mode` is `daily` (today's official puzzle, or the player's own unfinished daily from yesterday), `practice` (an earlier day from the archive) or `challenge` (any run opened from a friend's same-puzzle link, including today's puzzle opened that way).

| Path | Fired when | Answers |
| --- | --- | --- |
| `/e/visit/new` | first time this browser opens the game (needs working localStorage) | new browsers |
| `/e/visit/return/gap-{1,2-6,7plus}[/day1,/day7]` | first open on a new Eastern puzzle day by a browser seen before. `gap` = days since its last visit. `/day1` or `/day7` is added when the browser's first visit was exactly 1 or 7 days earlier | next-day and day-7 returns |
| `/e/start/{mode}` | a fresh run opens (no rounds saved yet) | game starts |
| `/e/sample/start/daily` | start of a daily included in the 10% diagnostic sample | denominator for sampled first touch and Q1 lock |
| `/e/sample/first-touch/daily` | first bracket move of the sampled daily's first round | first-screen understanding |
| `/e/sample/lock/daily/r{1-5}/{hit,miss}` | a round locks in the same sampled daily | drop-off and hit rate by question position |
| `/e/complete/{mode}/{0-99,…,400-500}` | round 5 locked | completion, score bands |
| `/e/streak/daily/{1,2-6,7plus}` | once per completed daily (round 5 locked on a run saved to the daily record, including today's puzzle opened from a friend's link; never practice). The number is the daily streak that completion leaves, counted from this browser's saved days and bucketed like `gap` | are players coming back day after day? |
| `/e/share/{mode}/{native,clipboard,failed,cancelled}` | share button result | share attempts |
| `/e/challenge-open/{today,past,future,invalid}[/with-score[/with-rounds]]` | page opened with a `?day=` link; `/with-rounds` when it carried five valid round scores (friend race, link v2) | challenge links that worked |
| `/e/share/{mode}/{native-image,image-saved}` | native PNG sharing resolved after a target was picked / "Save score card" started a download | did the share or download action begin? |
| `/e/failure/{game,comparison}` | a game load or render fails, or a score comparison returns unavailable | coarse availability signals |
| `/e/privacy/{scores-on,scores-off,deleted}` | a comparison choice or a deletion in the app | consent and deletion rates |
| `/e/remind/{ics,google}` | a calendar reminder link is tapped on any results screen (each tap) | how many players try to add a daily reminder |
| `/e/remind/open` | the page is opened from the reminder event's link (`?from=calendar`), once per browser and puzzle day (midnight-to-midnight New York time), before `/e/start/*`. The parameter is then removed from the address | opens the reminder caused |
| `/e/scouting/open/{home,results}` | the Scouting Report was opened from the home screen or a results screen (each open; a user action) | is the report worth keeping, and where is it found |
| `/e/weekly/open/{home,results,scouting}` | the Weekly Scoreboard was opened from that entry point | weekly engagement |
| `/e/weekly/share/{native,clipboard,failed,cancelled}` | the weekly scorecard share button result | does the weekly card get used? |
| `/e/weekly/share/{native-image,image-saved}` | native PNG sharing resolved after a target was picked / "Save image" started a download | did the share or download action begin? |
| `/e/practice/{expand,start}/home` | the home "Practice" disclosure was opened / a past game was started from it | practice discovery |
| `/e/tutorial/{start,skip,complete}` | the first-play tutorial was shown (per page load) / skipped before its lock / played through to its Play button (V5.2) | tutorial start and completion |
(V5.1 entries carry no scores, days, answers or counts: only the fixed words in braces.)

Survival and its experiment add the paths in `docs/SURVIVAL.md` ("Measurement"); they are only sent from a build with `VITE_SURVIVAL=on`, which production does not have.

### Metrics, and how to read them

| Metric | From | Early hypothesis to test |
| --- | --- | --- |
| First-screen understanding | `sample/first-touch/daily` ÷ `sample/start/daily` | > 90% |
| Daily completion | `complete/daily/*` ÷ `start/daily` | ≥ 75% |
| Round drop-off | `sample/lock/daily/r{n}` compared with the preceding sampled lock | no single round loses > 10% |
| Recorded share attempts | `share/daily/*` ÷ `complete/daily/*` | ≥ 10% |
| Challenge pull | `start/challenge` and `complete/challenge/*` ÷ shares | any is a signal |
| Next-day return | `visit/return/…/day1` ÷ `visit/new` from the previous day (the readout uses the same range for both, which overstates it slightly when new visitors are growing) | > 25% |
| Streak mix | `streak/daily/2-6` + `streak/daily/7plus` ÷ `streak/daily/*` | rises week over week |
| Day-7 return | `visit/return/…/day7` ÷ `visit/new` seven days earlier | > 15% |
| Reminder uptake | `remind/{ics,google}` ÷ `complete/*/*` | > 3% |
| Reminder pull | `remind/open` per day, next to `visit/return/gap-1` for the same day. A lower bound: blocked script, and players who see the alarm but open a bookmark, are missed | any is a signal |

The reminder events don't change the per-game budget above: taps are rare and the open replaces nothing a game sends. Next-day return before and after the reminder shipped is directional only, because the players who add one are already keen; a causal number needs an A/B arm (`/e/x/remind/{offer,control}/…`), which is not built.

## What these numbers are not

- **Browsers, not people.** One person on a phone and a laptop is two browsers. Clearing site data makes a returning player look new. Private windows always look new.
- **A share is an attempt, not a delivery.** `native` means the share sheet was opened and the player picked a target; whether they sent it is not observable. `clipboard` means it was copied, not pasted. Pasted links that are never opened are invisible.
- **Challenge opens are link opens, not verified new players.** `/e/challenge-open/*` counts any visit with a `?day=` link, including the sender re-opening their own.
- **Round loss is approximate.** Count sampled locks over a window that allows players to resume. A lock can follow its start on a different analytics date. A closed tab can lose queued views.
- **Counts can be blocked or faked.** Ad blockers block Vercel's script; anyone can call the endpoint. Treat everything as directional. Nothing here is a leaderboard or a verified competition.
- With little traffic, report raw counts and ranges. Don't call a difference a win until both arms have enough completed games for the gap to be bigger than the noise.

## Experiments (once real events are flowing; not built yet)

Every player gets the same five questions on a given day, whatever their arm. Only presentation changes.

1. **First-round wording or reveal presentation.** Primary: Q1 → all-five completion. Guardrail: no new accessibility failures, no slower first paint.
2. **Share copy and challenge framing.** Primary: challenge starts per share attempt. Guardrail: the share text never contains an answer (unit-tested).
3. **Next-day teaser** from existing, non-secret metadata (for example the sports on tomorrow's slate, never questions or answers). Primary: next-day return. Guardrail: no countdown pressure, no future answers.

To run one: assign an arm per browser at random, store it in localStorage, add the arm as a path segment (`/e/x/{test}/{arm}/…`), and compare counts. Not built in this sprint because there is no traffic to measure it with yet.

## Monetization hypotheses (do not build until retention is proven)

The daily game stays free, with no ads in the play area and nothing that buys points.
1. **Archive pass:** past puzzles beyond the last 7 days, plus themed packs. Validate with `/e/start/practice` among returning browsers first.
2. **Private leagues:** a code that groups friends' daily scores. Needs a backend and anti-cheat (server-side slates).
3. **Sponsored themed weeks**, editorially separate from scoring.

Before any paid feature on Vercel, check whether the plan's terms allow commercial use; it may require a paid plan, which conflicts with the $0 constraint today.

## NBA calendar checks (from 2026-11-18)
Use sampled hit rates to evaluate the overall difficulty curve first. Review individual days only when each question position has enough sampled locks. Treat consistently inverted round difficulty as a prompt to inspect future and reserve facts in `data/nba` and preserve published slates.

## Referral attribution (distribution update)

Recognized UTM sources or exact allowlisted referrer hosts become a fixed coarse channel, using `src/lib/referral.ts`. Only after analytics is allowed, the fixed channel may be kept in tab sessionStorage under a fixed cohort key; untagged reloads or internal navigation can restore it, but unknown explicit tags or unknown external arrivals clear it. An untagged direct revisit in the same tab can inherit the channel; this is directional session attribution, not individual conversion. The browser may restore a tab session; no localStorage marketing profile, timestamp, cookie or identifier is added. Opt-out clears the channel in memory and storage; blocked storage falls back to page-load attribution. A different season or QA cohort does not inherit the channel. Recognized arrivals send `/e/referral/{channel}/landing`; restored channels do not send a new landing. Daily/challenge starts and finishes add `/e/referral/{channel}/start` and `/e/referral/{channel}/complete` subject to existing once-per-run and consent checks. Practice is excluded. Tagged reloads can still count a new landing. A tagged completed run adds up to three views; restored attribution can recover otherwise missing start/complete views (up to two per run), not add a new event type. Counts are not unique people or a joined cohort. No raw UTM text, raw referral URL or added identifiers are sent. 

Use `https://www.statwindow.app/?utm_source=reddit&utm_medium=social&utm_campaign=organic`, replacing reddit with x, threads, playlin, alldle, directory, email, creator, groupchat, embed, google, bing, tiktok, youtube, instagram, producthunt or hackernews as appropriate. Compare landing, start and complete counts by channel and season; do not infer causal attribution or a unique-player conversion rate. Test with `?qa=1&utm_source=reddit` in an isolated browser and check `/e/qa/referral/reddit/landing`, start and complete receipt. Test opt-out and GPC/DNT, unknown tags, and direct visits. Production receipt is not yet verified.
