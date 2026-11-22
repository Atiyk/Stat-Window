# Measurement

Nothing here has been validated with real players yet. No retention, completion or share numbers exist until the steps under "Turning it on" are done and traffic arrives.

## What is wired

`src/lib/track.ts` sends a fixed set of events to **Vercel Web Analytics**, which the project's Hobby plan includes at no cost.

- **Why page views:** on Hobby, Vercel's custom events are not available ("Custom Events are available on Enterprise and Pro plans", [Vercel docs](https://vercel.com/docs/analytics/custom-events)). So each event is sent as a *virtual page view* on a path under `/e/…`, using the package's `pageview()` call. The counts appear in the dashboard's **Pages** list, one row per path.
- **Cost:** Hobby includes 50,000 events a month (page views and virtual page views both count). At the limit, collection pauses; "You will not pay for any additional usage" ([Vercel limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing)). Rough budget: about 17 events per complete game (page view, visit, start, first touch, five locks, five Nexts, completion, streak, share), so roughly 2,900 complete games a month before collection pauses.
- **On only on the production site.** Events are sent on the configured production hostnames, or on any host when the build sets `VITE_ANALYTICS=vercel` (the analytics e2e build). Previews, local runs and CI send nothing (in development they log to the console instead). `VITE_ANALYTICS=off` in Production switches it off after a redeploy.
- **Production hostnames (`VITE_ANALYTICS_HOSTS`).** An optional build-time, comma-separated list of exact hostnames, for example `statwindow.example,stat-window.vercel.app`. Unset or empty means `stat-window.vercel.app`. Names are matched exactly and case-insensitively: no scheme, port, path or wildcard (entries like `https://…` or `*.vercel.app` are ignored), so `*.vercel.app` previews and other subdomains stay off. Setting it **replaces** the default, so keep `stat-window.vercel.app` in the list while both addresses serve the game. Moving to a real domain is this variable plus a redeploy, with no code change (`docs/LAUNCH.md`, "Moving to a custom domain"). Code: `analyticsHosts()` in `src/lib/track.ts`.
- **Auto-tracking is off; the real page view is sent by hand.** The Vercel script remembers the last `path` passed to `pageview()` and reuses it for later automatic page views (read from `va.vercel-scripts.com/v1/script.debug.js`, v0.1.3, on 2026-11-16), so with auto-tracking on, a real visit could be filed under a stale `/e/…` path. `startAnalytics()` injects with `disableAutoTrack: true` and sends `pageview({ route: '/', path: '/' })` once per page load.
- **Counted once** (from the NBA release on 2026-11-16; before it, a refresh before the first lock re-counted a start, so don't compare start or first-touch counts across that date). `start` and `first-touch` are sent once per browser, mode and day (`trackOnce`, kept 14 days in localStorage), so a refresh, a remount or a second tab doesn't add a second start. A lock is counted by the tab that made it; a tab that adopts rounds from another tab doesn't recount them. React StrictMode double effects only happen in development, where nothing is sent.
- **What has been proven, and what hasn't.** `npm run test:e2e:analytics` builds with `VITE_ANALYTICS=vercel`, stubs Vercel's script and checks the exact queue of page views the app hands it (funnel order, no duplicates after reloads, challenge vs daily, query string stripped, nothing at all under GPC/DNT). It does **not** prove Vercel receives them: that needs the production check in "Turning it on", step 4 (see "Production status").
- **Privacy:** no cookies or identifiers from us, no answers, no typed text, no scores beyond a 100-point band. Every path segment comes from the fixed list below. Real page-view URLs are stripped of their query string, so challenge links (`?day=…&vs=…`) are not collected. Full notice: `docs/PRIVACY.md`, served as `/privacy.html`.
- **Choices (from Phase 1, 2026-11-18).** "Privacy and your data" (results footer, and the help dialog) has an on/off switch for usage counts, stored in `stat-window:privacy:v1`. Browsers that send Global Privacy Control or Do Not Track start with it **off**; only an explicit tap in that dialog turns it on for that browser. The sink re-checks the choice before every event, so switching off stops the next event, not the next page load. Switching it on takes effect immediately (`resumeAnalytics()`): the script loads and one real page view is sent if the host allows analytics. When storage fails, the choice remains in memory for the session.
- **Cohorts.** Paths are prefixed so test and launch traffic never mix with the beta: `/e/qa/…` for any browser opened once with `?qa=1` (kept in `stat-window:qa`; use it for every manual production check), `/e/s1/…` once the formal launch is active (`docs/LAUNCH.md`). Unprefixed `/e/…` is the public beta.

### Production status (checked 2026-11-18)

| Check | Result |
|---|---|
| Web Analytics enabled for the project | Yes. Enabled in the dashboard on 2026-11-18 (Hobby, capped ingestion). |
| `VITE_ANALYTICS=vercel` set for Production | Yes, as a Config variable, Production only. Preview and local builds still send nothing. |
| Phase 1 production build (`c30d612`) | Built **without** the variable: the variable was saved within the same minute as the merge and missed that build. The live bundle had analytics compiled off and the Privacy dialog said "Not active on this site build". |
| Fix | The next build (`98683e9`) produced a byte-identical bundle, so the build never saw `vercel`; the saved value is most likely wrong and can only be read after an email check. Since 2026-11-18 the app no longer depends on it: analytics turns on by hostname (see above). |

Read every count before the receipt check as "not collected", not "zero".

### Turning it on (owner, about two minutes)

1. Vercel dashboard → the `stat-window` project → **Analytics** → **Enable** Web Analytics (Hobby, free).
2. Nothing else: the production hostname turns it on (`stat-window.vercel.app`, or the list in `VITE_ANALYTICS_HOSTS`). (To switch it off, set `VITE_ANALYTICS` = `off` for Production and redeploy.)
3. Deploy production (merge anything to `main`).
4. Check receipt (about five minutes, from a normal browser window with no ad blocker and Do Not Track / GPC off):
   1. Open https://stat-window.vercel.app/ with DevTools → Network open, filter `view`.
   2. You should see a `POST …/view` request (Vercel's docs say `/_vercel/insights/view` or `/<unique-path>/view`) with status 200 for the page, then one per event as you play: start, first touch, lock r1, Next, … complete.
   3. If you instead see a console line `[Vercel Web Analytics] Failed to load script`, step 1 or 3 is not done.
   4. Within a few minutes, Analytics → **Pages** should list `/e/start/daily`, `/e/first-touch/daily`, `/e/lock/daily/r1/hit` (or `miss`) and so on.
   5. Your test game adds about 17 events. That is fine; note the time so you can exclude it when reading early numbers.

Until step 2 is done, production sends nothing.

Note on the Content-Security-Policy in `vercel.json` (`script-src 'self'`, `connect-src 'self'`): on Vercel the script and the endpoint are served from the site's own origin (`/_vercel/insights/…`), so the policy allows them. If step 4 shows a CSP error in the console instead, that assumption is wrong and the policy needs the endpoint added; report it rather than loosening the policy blind.

### Reading it (no dashboard to build)

Copy the Pages list for a date range (path and count per line, CSV or tab separated) into a file and run:

```bash
node --experimental-strip-types scripts/analytics-readout.ts pages.csv        # --min 30 by default
```

It prints the funnel below with the equation used for each line, and says "not enough data" for any rate whose denominator is under 30. With today's traffic, expect that for every line. It also prints the Survival rows and, once each arm has 200 exposures, the experiment's difference with a 95% interval.

Sample input and output (made-up counts, to show the format; **not real traffic**):

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
| `/e/first-touch/{mode}` | first bracket move of round 1 | did the first screen make sense? |
| `/e/lock/{mode}/r{1-5}/{hit,miss}` | a round is locked | drop-off by round, hit rate per round |
| `/e/next/{mode}/r{1-5}` | Next pressed after round N's reveal | round completion |
| `/e/exit/{mode}/r{n}` | page hidden or closed mid-run (best effort) | where people leave |
| `/e/complete/{mode}/{0-99,…,400-500}` | round 5 locked | completion, score bands |
| `/e/streak/daily/{1,2-6,7plus}` | once per completed daily (round 5 locked on a run saved to the daily record, including today's puzzle opened from a friend's link; never practice). The number is the daily streak that completion leaves, counted from this browser's saved days and bucketed like `gap` | are players coming back day after day? |
| `/e/share/{mode}/{native,clipboard,failed,cancelled}` | share button result | share attempts |
| `/e/challenge-open/{today,past,future,invalid}[/with-score]` | page opened with a `?day=` link | challenge links that worked |
| `/e/share/{mode}/{native-image,image-saved}` | share sheet sent the PNG score card / "Save score card" downloaded it | does the card get used? |
| `/e/percentile/{stored,gathering,ready,consent,ineligible,disabled,unavailable}` | once per browser and day, when the results screen settles the comparison | how many players see a real percentile vs the "not enough games" line |
| `/e/privacy/{scores-on,scores-off,deleted}` | a comparison choice or a deletion in the app | consent and deletion rates |
| `/e/remind/{ics,google}` | a calendar reminder link is tapped on any results screen (each tap) | how many players try to add a daily reminder |
| `/e/remind/open` | the page is opened from the reminder event's link (`?from=calendar`), once per browser and UTC day, before `/e/start/*`. The parameter is then removed from the address | opens the reminder caused |

Survival and its experiment add the paths in `docs/SURVIVAL.md` ("Measurement"); they are only sent from a build with `VITE_SURVIVAL=on`, which production does not have.

### Metrics, and how to read them

| Metric | From | Early hypothesis to test |
| --- | --- | --- |
| First-screen understanding | `first-touch/daily` ÷ `start/daily` | > 90% |
| Q1 → all five | `complete/daily/*` ÷ `lock/daily/r1/*` | > 70% |
| Round drop-off | `lock/…/r{n}` across n | no single round loses > 10% |
| Share attempts | `share/daily/{native,clipboard}` ÷ `complete/daily/*` | > 10% |
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
- **Exits are best effort.** Browsers may drop events sent while a page closes.
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
The slates now climb Easy, Medium, Hard, Hard, Expert. Once `/e/lock/daily/r{n}/{hit,miss}` counts arrive, check per puzzle that the hit rate falls from round 1 to round 5. A Hard or Expert round that scores higher than round 1 on two or more days in a week means its difficulty rating was wrong; fix the rating and range of future and reserve facts in `data/nba`, never a published day. Also compare scores on themed and mixed days, and track the share of rounds locked with the full scale untouched, by round.
