# Formal launch (Day 1) runbook

This page is the runbook for the one step that switches the official season on, and the record of where that step stands.

## V5.3 launch schedule

| Item | State |
|---|---|
| `LAUNCH_DAY` | `'2026-11-28'` in `src/engine/launch-config.ts`. |
| Production schedule | On November 27, `https://www.statwindow.app/launch.json` served `{"launchDay":"2026-11-28"}` from V5.3 (`1f80a4ae362a9d5709d3834c1fae52cc513c4e76`). |
| Scheduled activation | 12:00 AM Eastern on Saturday, November 28 (05:00 UTC). |
| First week | Saturday Game 1 and Sunday Game 2 count toward the first Weekly Scoreboard, for a 1,000-point maximum. Monday Game 3 begins the first full week. |
| Observed activation | Record who verified Game 1 on production and when after the boundary. A local clock simulation and a deployed schedule are separate checks. |
| Vercel environment | Both obsolete launch variables were absent from the environment listing checked November 27. The [V5.2 record](V5.2-PROGRESS.md) has the earlier build history. |

**Delete `VITE_LAUNCH_DAY` and `LAUNCH_DAY` from every Vercel environment (Production, Preview and Development).** Nothing reads them any more. The launch day is the committed value, and `assertLaunchEnv` (called from `vite.config.ts`) fails any build whose environment sets either one to a different value. In Vercel → stat-window → Settings → Environment Variables, check each environment separately.

## How numbering works (`src/engine/season.ts`)

| Concept | Value | Changes at launch? |
|---|---|---|
| Canonical puzzle day | the Eastern calendar date of `content/days/<day>.json` | never |
| Content id / fingerprint | `content/published.lock.json` | never for a published day; unpublished days follow `data/nba` |
| Season | `beta`, then `s1` from the launch day | yes, by config |
| Public number | beta: days since 2026-11-15 + 1; launch: days since `LAUNCH_DAY` + 1 | yes |

- Before *L*, editorial may revise unpublished slates and regenerate their lock entries. Published days never change. The official launch day *L* must have a verified slate.
- From *L*, *L* is "No. 1", *L+1* "No. 2". The public archive starts empty and grows from *L* onward. Beta slates earlier than *L* are hidden from the archive and not playable through old `?day=`/`vs` challenge links. Retired links show an explicit message and open today's game without the old comparison score. Before *L*, the beta catalog behaves as before.
- Stats, streaks and averages count only the current season's runs. Historical beta saves remain stored but are no longer publicly playable after launch. A catalog reset is **not** permission to delete local data, percentile data, or participant erasure records.
- Score percentiles are partitioned by season on the server (`sw:v1:production:s1:<day>`), and analytics paths get an `/e/s1/…` prefix, so beta and launch numbers never mix.
- Rollover is at 12:00 AM Eastern (DST-aware); the results screen already shows the local time.

## Choosing L

- *L* must be a day that already has a published slate (or will, after the Question Factory), and must be after today. If *L* is past the last scheduled day (2027-01-27 on 2026-11-26), schedule more content first: `docs/QUESTION-FACTORY.md`.
- Pick *L* at least 2 days ahead so deployment can finish before midnight Eastern. The November 28 advance is tied to the November 30 production schedule and closes at 8:00 PM Eastern on November 27.

## Launch inventory

The two V5.3 opening slates have a separate audit in `data/nba/editorial/v53-audit.json`. The V5.2 audit covers the 59 slates from November 30 through January 27. All 61 slates use a 2/2/1 mix of recall, reference and missing point. Run `npm run content:publish:check` and the editorial audit tests before merging. The V5.0, V5.1 and V5.2 audits record their respective releases.

## Preflight (the day before)

1. `npm ci && npm run content:check && npm test && npm run build`.
2. Dry run in a preview. Build with `VITE_LAUNCH_PREVIEW=1` (Preview environment only) and open `/?launch-preview=<L>` with the clock on *L* and *L-1*. Before *L*, check that the beta catalog still works. On *L*, check that the header shows “Game 1,” the archive starts empty, retired beta `?day=` links show a notice and open today's game, results stats count only *L*, and share text says “Stat Window No. 1.” On *L+1*, the archive should contain only *L*. Also check valid s1 challenges, saved runs, Eastern DST, Survival, and privacy.
3. Unit tests cover it with a synthetic launch day: `src/engine/season.test.ts`.

## The one activation step (V5.1: committed, not a dashboard variable)

The launch day lives in **`src/engine/launch-config.ts`** (`LAUNCH_DAY`), one value read by the client label, the score API's season and the CI gates. Activation is a reviewed commit to main that sets it to *L*; Vercel deploys main automatically.

- `npm run season:check -- --base origin/main` checks the future Eastern boundary, the two-day lead, `VARIETY_FROM`, the 28-slate minimum, and whether the outgoing season has begun. The November 27 exception applies only to advancing November 30 to November 28 before 8:00 PM Eastern. All other checks apply to that transition.
- The build fails if `VITE_LAUNCH_DAY` or `LAUNCH_DAY` is still set in an environment to a different value (`assertLaunchEnv`), so a stale dashboard value can never split the client and server seasons. Delete both from every Vercel environment, Preview included (see Current state).
- **The production build guards the boundary itself** by reading `https://$VERCEL_PROJECT_PRODUCTION_URL/launch.json`. The first November 28 production build requires the prior November 30 manifest and must pass that check before 8:00 PM Eastern on November 27. After that cutoff, builds for November 28 require production to already serve November 28. If the manifest is unreadable, this advance fails closed. For other launches that have begun, `LAUNCH_GUARD_ACK=<L>` applies only to an unreadable manifest, after confirming production already shows No. 1. A configured `VITE_LAUNCH_PREVIEW` fails any production build.
- Make the CI check a **required status** on main (GitHub → Settings → Branches → main → Require status checks: `check`), so a PR whose check went stale can't be merged without re-running it.
- Tabs opened before the activation deploy fetch `/launch.json` at the midnight rollover and reload if the deployed launch day differs from their bundle, so a long-open tab doesn't keep beta numbering on *L*.
- The first November 28 schedule deployment cleared the November 27 cutoff. For any subsequent release, verify the production deployment SHA and confirm `/launch.json` still reports November 28. At the scheduled boundary, verify that the public homepage shows Game 1.
- The activation deadline applies to the first build for that schedule. A later release can rebuild the November 28 schedule while production's manifest still reports November 28. If the first activation was missed entirely, clear the schedule with `LAUNCH_DAY = null` and `SEASON_ROLLBACK_FROM = '<L>'`, then schedule a future day in a later PR. If the season already opened and an Instant Rollback restored an older schedule, follow the emergency procedure below and preserve existing `s1` records.
- `LAUNCH_GUARD_ACK` is a one-deploy override; delete it from the Vercel environment straight after (the build warns while it is set).

## Production domains

Publish and share `https://www.statwindow.app/`. Vercel redirects `statwindow.app` to www with a permanent 308 that keeps the path and query. Keep `stat-window.vercel.app` serving this build during migration so old links can open the branded site with their original parameters and players can move browser-local progress. For a timed game already open on the old site, reload that same tab to move its clock. Installed apps retain their existing origin and scope.

The production analytics allow-list defaults to `www.statwindow.app,statwindow.app,stat-window.vercel.app` in code. Vercel's optional `VITE_ANALYTICS_HOSTS` variable can replace this list for a future build. The score API accepts requests whose `Origin` matches the host they were sent to (`server/api.ts`, `sameOrigin`). Follow [the branded production analytics check](MEASUREMENT.md#turning-it-on-owner-about-two-minutes) after deployment.


## Rollback

- **Before *L*:** revert the commit (or set `LAUNCH_DAY = null`). Nothing has changed for players.
- **After *L* (emergency only):** in one reviewed commit, set `LAUNCH_DAY = null` and `SEASON_ROLLBACK_FROM = '<L>'` (both in `src/engine/launch-config.ts`). The season check accepts cancelling a started season only when the acknowledgement names it, so the step needs no CI secret and shows in review. Deletion keeps working: DELETE searches every season in `SEASONS`, whatever the launch day is now. Labels return to beta numbering and stats include all runs again. Season `s1` score, question-aggregate and analytics data stay in their own `s1` keys and paths (they never mixed with beta), so a later relaunch must use a **new season id** (`s2`), never re-open `s1`: add it to `SeasonId` in `src/engine/season.ts` and give it its own keys. Challenge links of `s1` days then retire like beta links did. Do not flush Redis or clear anyone's local data.

## What launch does not do

- It deletes no one's saved game or privacy data; it only retires the visible, playable beta catalog.
- It does not relabel beta share messages already posted (they keep saying "No. N").
